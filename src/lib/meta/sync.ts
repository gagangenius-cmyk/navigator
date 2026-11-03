/**
 * Meta Lead Ads auto-sync.
 *
 * Keeps the CRM in step with Meta without anyone touching the dashboard:
 *  - new campaigns          -> crm_meta_campaign_cache
 *  - new Instant Forms and their questions -> crm_meta_forms + FORM-scope
 *    rows in crm_meta_lead_mappings (auto_generated = 1, never overwriting a
 *    mapping an admin already created)
 *  - leads whose webhook never arrived -> backfilled and run through the
 *    normal processor
 *  - Page -> app `leadgen` subscription kept in place
 *
 * Triggered from: the in-process cron (meta-sync-cron.ts), the HTTP cron
 * route (/api/cron/meta-sync, for Vercel), the admin "Sync now" button, and
 * lazily from the lead processor the first time an unknown form delivers a lead.
 */

import crypto from 'crypto';
import { QueryTypes } from 'sequelize';
import { sequelize } from '@/lib/sequelize';
import {
  fetchCampaigns,
  fetchPageLeadForms,
  fetchLeadForm,
  fetchFormLeads,
  ensurePageSubscribed,
  registerAppWebhook,
} from './graph-api';
import { suggestMappingsForForm, normalizeFieldKey } from './auto-map';
import { processWebhookEvent } from './processor';
import { ensureMetaCampaignNameColumn } from '@/lib/ensureMetaCampaignNameColumn';
import type { MetaLeadForm } from './types';

// ── Schema (self-migrating; see migrations/20261020_meta_auto_sync.sql) ──────

let schemaReady: Promise<void> | null = null;

async function addColumnIfMissing(table: string, column: string, ddl: string) {
  const [rows] = await sequelize.query(
    `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :table AND COLUMN_NAME = :column`,
    { replacements: { table, column } },
  ) as unknown as [Array<{ cnt: number }>];
  if (Number(rows?.[0]?.cnt || 0) === 0) {
    await sequelize.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

export function ensureMetaSyncSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await sequelize.query(`
        CREATE TABLE IF NOT EXISTS crm_meta_forms (
          id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          form_id VARCHAR(64) NOT NULL,
          page_id VARCHAR(64) NULL,
          form_name VARCHAR(255) NULL,
          status VARCHAR(32) NULL,
          locale VARCHAR(16) NULL,
          questions JSON NULL,
          question_count INT NOT NULL DEFAULT 0,
          auto_mapped_count INT NOT NULL DEFAULT 0,
          meta_created_time DATETIME NULL,
          last_synced_at DATETIME NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY uq_mf_form_id (form_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
      await addColumnIfMissing('crm_meta_lead_mappings', 'auto_generated', 'TINYINT(1) NOT NULL DEFAULT 0');
      await addColumnIfMissing('crm_meta_settings', 'last_auto_sync_at', 'DATETIME NULL');
      await addColumnIfMissing('crm_meta_settings', 'last_auto_sync_summary', 'TEXT NULL');
      await addColumnIfMissing('crm_meta_settings', 'webhook_subscribed_at', 'DATETIME NULL');
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

// ── Config ───────────────────────────────────────────────────────────────────

export interface MetaSyncConfig {
  enabled: boolean;
  pageId: string | null;
  adAccountId: string | null;
}

/** DB settings win; META_PAGE_ID / META_AD_ACCOUNT_ID env vars are the fallback. */
export async function getMetaSyncConfig(): Promise<MetaSyncConfig> {
  const [row] = await sequelize.query<{ is_enabled: number; page_id: string | null; ad_account_id: string | null }>(
    `SELECT is_enabled, page_id, ad_account_id FROM crm_meta_settings WHERE id = 1 LIMIT 1`,
    { type: QueryTypes.SELECT },
  );
  const pageId = (row?.page_id || process.env.META_PAGE_ID || '').trim() || null;
  const adAccountId = (row?.ad_account_id || process.env.META_AD_ACCOUNT_ID || '').trim().replace(/^act_/i, '') || null;
  return { enabled: !!row?.is_enabled, pageId, adAccountId };
}

const toMysqlDate = (v?: string | null) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 19).replace('T', ' ');
};

// ── Campaigns ────────────────────────────────────────────────────────────────

export async function syncCampaigns(adAccountId: string): Promise<{ synced: number; renamedLeads: number }> {
  const campaigns = await fetchCampaigns(adAccountId);
  for (const c of campaigns) {
    const insight = c.insights?.data?.[0];
    await sequelize.query(
      `INSERT INTO crm_meta_campaign_cache
         (campaign_id, campaign_name, status, objective, daily_budget, lifetime_budget,
          spend, impressions, clicks, raw_data, last_synced_at)
       VALUES (:id, :name, :status, :objective, :daily_budget, :lifetime_budget,
               :spend, :impressions, :clicks, :rawData, NOW())
       ON DUPLICATE KEY UPDATE
         campaign_name = VALUES(campaign_name), status = VALUES(status),
         objective = VALUES(objective), daily_budget = VALUES(daily_budget),
         lifetime_budget = VALUES(lifetime_budget), spend = VALUES(spend),
         impressions = VALUES(impressions), clicks = VALUES(clicks),
         raw_data = VALUES(raw_data), last_synced_at = NOW(), updated_at = NOW()`,
      {
        replacements: {
          id: c.id, name: c.name ?? null, status: c.status ?? null,
          objective: c.objective ?? null,
          daily_budget: c.daily_budget ? parseFloat(c.daily_budget) / 100 : null,
          lifetime_budget: c.lifetime_budget ? parseFloat(c.lifetime_budget) / 100 : null,
          spend: insight?.spend ? parseFloat(insight.spend) : 0,
          impressions: insight?.impressions ? parseInt(insight.impressions) : 0,
          clicks: insight?.clicks ? parseInt(insight.clicks) : 0,
          rawData: JSON.stringify(c),
        },
        type: QueryTypes.INSERT,
      },
    );
  }

  // A campaign renamed in Ads Manager must not leave its existing leads (and the
  // Leads-list campaign filter / assignment rules keyed on the name) on the old
  // name: re-stamp every lead from the campaign id Meta reported for it.
  let renamedLeads = 0;
  try {
    await ensureMetaCampaignNameColumn();
    await sequelize.query(
      `UPDATE crm_meta_leads ml
       JOIN crm_meta_campaign_cache c ON c.campaign_id = ml.campaign_id
       SET ml.campaign_name = c.campaign_name
       WHERE c.campaign_name IS NOT NULL AND c.campaign_name <> ''
         AND (ml.campaign_name IS NULL OR ml.campaign_name <> c.campaign_name)`,
    );
    const [res] = await sequelize.query(
      `UPDATE crm_forum_leads l
       JOIN crm_meta_leads ml ON ml.meta_lead_id = l.meta_leadgen_id
       JOIN crm_meta_campaign_cache c ON c.campaign_id = ml.campaign_id
       SET l.meta_campaign_name = LEFT(c.campaign_name, 255)
       WHERE c.campaign_name IS NOT NULL AND c.campaign_name <> ''
         AND (l.meta_campaign_name IS NULL OR l.meta_campaign_name <> LEFT(c.campaign_name, 255))`,
    ) as unknown as [{ affectedRows?: number }];
    renamedLeads = Number(res?.affectedRows || 0);
  } catch (err) {
    console.warn('[Meta Sync] campaign rename propagation failed:', err instanceof Error ? err.message : err);
  }

  await sequelize.query(
    `UPDATE crm_meta_campaign_cache c
     SET c.leads_count = (SELECT COUNT(*) FROM crm_meta_leads ml WHERE ml.campaign_id = c.campaign_id)`,
    { type: QueryTypes.UPDATE },
  );
  await sequelize.query(`UPDATE crm_meta_settings SET last_campaign_sync_at = NOW() WHERE id = 1`, { type: QueryTypes.UPDATE });
  return { synced: campaigns.length, renamedLeads };
}

// ── Forms + auto mapping ─────────────────────────────────────────────────────

/** Upserts one form and creates any missing FORM-scope mappings for its questions. */
export async function upsertFormAndMappings(
  form: MetaLeadForm,
  pageId: string | null,
): Promise<{ isNew: boolean; mappingsCreated: number; mappingsRemoved: number }> {
  await ensureMetaSyncSchema();
  const questions = form.questions ?? [];

  const [existing] = await sequelize.query<{ id: number }>(
    `SELECT id FROM crm_meta_forms WHERE form_id = :formId LIMIT 1`,
    { replacements: { formId: form.id }, type: QueryTypes.SELECT },
  );

  // Mappings already in effect for this form: GLOBAL ones plus anything the
  // admin (or an earlier sync) created at FORM scope. Never duplicate/override them.
  const current = await sequelize.query<{ scope_type: string; form_id: string | null; meta_field_key: string; crm_field_key: string }>(
    `SELECT scope_type, form_id, meta_field_key, crm_field_key
     FROM crm_meta_lead_mappings
     WHERE scope_type = 'GLOBAL' OR (scope_type = 'FORM' AND form_id = :formId)`,
    { replacements: { formId: form.id }, type: QueryTypes.SELECT },
  );
  const takenMetaKeys = new Set(current.map(m => normalizeFieldKey(m.meta_field_key)));
  const takenCrmKeys = new Set(current.filter(m => m.scope_type === 'FORM').map(m => m.crm_field_key));

  let mappingsCreated = 0;
  for (const s of suggestMappingsForForm(questions)) {
    if (takenMetaKeys.has(s.metaFieldKey) || takenCrmKeys.has(s.crmFieldKey)) continue;
    await sequelize.query(
      `INSERT INTO crm_meta_lead_mappings
         (scope_type, form_id, meta_field_key, crm_field_key, is_enabled, sort_order, auto_generated)
       VALUES ('FORM', :formId, :meta, :crm, 1, 100, 1)`,
      { replacements: { formId: form.id, meta: s.metaFieldKey, crm: s.crmFieldKey }, type: QueryTypes.INSERT },
    );
    takenMetaKeys.add(s.metaFieldKey);
    takenCrmKeys.add(s.crmFieldKey);
    mappingsCreated++;
  }

  // The form was edited on Meta and a question was removed/renamed: drop the
  // mappings the sync itself generated for it. Admin-created mappings
  // (auto_generated = 0) are never touched, and an empty question list (a
  // failed/partial Graph response) never prunes anything.
  let mappingsRemoved = 0;
  const liveKeys = questions.filter((q) => q?.key).map((q) => normalizeFieldKey(q.key));
  if (liveKeys.length > 0) {
    const [res] = await sequelize.query(
      `DELETE FROM crm_meta_lead_mappings
       WHERE scope_type = 'FORM' AND form_id = :formId AND auto_generated = 1
         AND meta_field_key NOT IN (:liveKeys)`,
      { replacements: { formId: form.id, liveKeys } },
    ) as unknown as [{ affectedRows?: number }];
    mappingsRemoved = Number(res?.affectedRows || 0);
  }

  const [{ cnt }] = await sequelize.query<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM crm_meta_lead_mappings WHERE scope_type = 'FORM' AND form_id = :formId AND is_enabled = 1`,
    { replacements: { formId: form.id }, type: QueryTypes.SELECT },
  );

  await sequelize.query(
    `INSERT INTO crm_meta_forms
       (form_id, page_id, form_name, status, locale, questions, question_count,
        auto_mapped_count, meta_created_time, last_synced_at)
     VALUES (:formId, :pageId, :name, :status, :locale, :questions, :qCount, :mapped, :created, NOW())
     ON DUPLICATE KEY UPDATE
       page_id = VALUES(page_id), form_name = VALUES(form_name), status = VALUES(status),
       locale = VALUES(locale), questions = VALUES(questions), question_count = VALUES(question_count),
       auto_mapped_count = VALUES(auto_mapped_count), last_synced_at = NOW()`,
    {
      replacements: {
        formId: form.id,
        pageId,
        name: form.name ?? null,
        status: form.status ?? null,
        locale: form.locale ?? null,
        questions: JSON.stringify(questions),
        qCount: questions.length,
        mapped: Number(cnt || 0),
        created: toMysqlDate(form.created_time),
      },
      type: QueryTypes.INSERT,
    },
  );

  return { isNew: !existing, mappingsCreated, mappingsRemoved };
}

export async function syncForms(pageId: string): Promise<{ forms: number; newForms: number; mappingsCreated: number; mappingsRemoved: number }> {
  const forms = await fetchPageLeadForms(pageId);
  let newForms = 0;
  let mappingsCreated = 0;
  let mappingsRemoved = 0;
  for (const form of forms) {
    const r = await upsertFormAndMappings(form, pageId);
    if (r.isNew) newForms++;
    mappingsCreated += r.mappingsCreated;
    mappingsRemoved += r.mappingsRemoved;
  }
  return { forms: forms.length, newForms, mappingsCreated, mappingsRemoved };
}

/**
 * Called by the lead processor before it builds a payload: if this form has
 * never been seen (brand new form, webhook arrived before any cron run) it is
 * fetched and auto-mapped on the spot. Returns the form name when known.
 * Best-effort - never throws.
 */
// A known form is only re-fetched at most this often, so a lead carrying a field
// Meta never lists in the form's questions cannot trigger a Graph call per lead.
const FORM_REFRESH_MIN_AGE_SECONDS = 300;

export async function ensureFormSynced(
  formId: string,
  pageId: string | null,
  fieldKeys: string[] = [],
): Promise<string | null> {
  try {
    await ensureMetaSyncSchema();
    const [known] = await sequelize.query<{ form_name: string | null; questions: unknown; age: number | null }>(
      `SELECT form_name, questions, TIMESTAMPDIFF(SECOND, last_synced_at, NOW()) AS age
       FROM crm_meta_forms WHERE form_id = :formId LIMIT 1`,
      { replacements: { formId }, type: QueryTypes.SELECT },
    );

    if (known) {
      // Known form: refresh only if this lead answers a question we have never
      // seen (the form was edited on Meta since the last sync) and the stored
      // copy is not brand new.
      if (!fieldKeys.length) return known.form_name;
      let stored: Array<{ key?: string }> = [];
      try {
        stored = typeof known.questions === 'string' ? JSON.parse(known.questions) : (known.questions as Array<{ key?: string }>) ?? [];
      } catch { stored = []; }
      const storedKeys = new Set(stored.filter((q) => q?.key).map((q) => normalizeFieldKey(String(q.key))));
      const hasUnseenField = fieldKeys.some((k) => !storedKeys.has(normalizeFieldKey(k)));
      const stale = known.age === null || Number(known.age) > FORM_REFRESH_MIN_AGE_SECONDS;
      if (!hasUnseenField || !stale) return known.form_name;
    }

    const form = await fetchLeadForm(formId);
    if (!form) return known?.form_name ?? null;
    await upsertFormAndMappings(form, pageId);
    return form.name ?? known?.form_name ?? null;
  } catch (err) {
    console.warn(`[Meta Sync] ensureFormSynced(${formId}) failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}

// ── Backfill ─────────────────────────────────────────────────────────────────

/**
 * Finds leads Meta has but the CRM doesn't (webhook dropped, server down, token
 * expired for a while) and pushes them through the normal processor.
 */
export async function backfillMissedLeads(hours = 48): Promise<{ checked: number; recovered: number }> {
  await ensureMetaSyncSchema();
  const forms = await sequelize.query<{ form_id: string }>(
    `SELECT form_id FROM crm_meta_forms WHERE status IS NULL OR UPPER(status) = 'ACTIVE'`,
    { type: QueryTypes.SELECT },
  );
  const since = Math.floor(Date.now() / 1000) - hours * 3600;
  let checked = 0;
  let recovered = 0;

  for (const { form_id: formId } of forms) {
    if (recovered >= 100) break;
    let leads;
    try {
      leads = await fetchFormLeads(formId, since);
    } catch (err) {
      console.warn(`[Meta Sync] backfill of form ${formId} failed:`, err instanceof Error ? err.message : err);
      continue;
    }

    for (const lead of leads) {
      checked++;
      const [have] = await sequelize.query<{ id: number }>(
        `SELECT id FROM crm_meta_leads WHERE meta_lead_id = :id LIMIT 1`,
        { replacements: { id: lead.id }, type: QueryTypes.SELECT },
      );
      if (have) continue;

      const [event] = await sequelize.query<{ id: number; processing_status: string; age_min: number }>(
        `SELECT id, processing_status, TIMESTAMPDIFF(MINUTE, received_at, NOW()) AS age_min
         FROM crm_meta_webhook_events WHERE leadgen_id = :id ORDER BY id DESC LIMIT 1`,
        { replacements: { id: lead.id }, type: QueryTypes.SELECT },
      );

      let eventId: number;
      if (event) {
        // Still in flight and recent - let it finish.
        if (['pending', 'processing'].includes(event.processing_status) && Number(event.age_min) < 10) continue;
        await sequelize.query(
          `UPDATE crm_meta_webhook_events SET processing_status = 'pending', error_message = NULL WHERE id = :id`,
          { replacements: { id: event.id }, type: QueryTypes.UPDATE },
        );
        eventId = event.id;
      } else {
        const hash = crypto.createHash('sha256').update(`backfill:${lead.id}`).digest('hex');
        const [insertId] = await sequelize.query(
          `INSERT INTO crm_meta_webhook_events
             (event_hash, leadgen_id, page_id, form_id, campaign_id, adset_id, ad_id,
              raw_payload, signature_validated, processing_status)
           VALUES (:hash, :leadgenId, NULL, :formId, :campaignId, :adsetId, :adId, :raw, 0, 'pending')
           ON DUPLICATE KEY UPDATE processing_status = 'pending', id = LAST_INSERT_ID(id)`,
          {
            replacements: {
              hash, leadgenId: lead.id, formId,
              campaignId: lead.campaign_id ?? null, adsetId: lead.adset_id ?? null, adId: lead.ad_id ?? null,
              raw: JSON.stringify({ source: 'backfill', leadgen_id: lead.id, form_id: formId }),
            },
            type: QueryTypes.INSERT,
          },
        ) as unknown as [number, number];
        eventId = Number(insertId);
      }

      await processWebhookEvent(eventId);
      recovered++;
    }
  }
  return { checked, recovered };
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

export interface MetaSyncSummary {
  ok: boolean;
  skipped?: string;
  campaigns?: { synced: number; renamedLeads: number };
  forms?: { forms: number; newForms: number; mappingsCreated: number; mappingsRemoved: number };
  backfill?: { checked: number; recovered: number };
  pageSubscription?: { subscribed: boolean; changed: boolean };
  webhookRegistered?: boolean;
  errors: string[];
  ranAt: string;
}

let running = false;

export async function runMetaAutoSync(opts: { registerWebhookUrl?: string; backfillHours?: number } = {}): Promise<MetaSyncSummary> {
  const summary: MetaSyncSummary = { ok: true, errors: [], ranAt: new Date().toISOString() };
  if (running) return { ...summary, skipped: 'A sync is already running' };
  running = true;

  try {
    await ensureMetaSyncSchema();
    const cfg = await getMetaSyncConfig();
    if (!cfg.enabled) return { ...summary, skipped: 'Integration is disabled in Meta settings' };

    const step = async <T>(name: string, fn: () => Promise<T>): Promise<T | undefined> => {
      try {
        return await fn();
      } catch (err) {
        summary.ok = false;
        summary.errors.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
        return undefined;
      }
    };

    if (opts.registerWebhookUrl) {
      summary.webhookRegistered = !!(await step('webhook registration', async () => {
        await registerAppWebhook(opts.registerWebhookUrl!);
        return true;
      }));
    }

    if (cfg.adAccountId) {
      summary.campaigns = await step('campaigns', () => syncCampaigns(cfg.adAccountId!));
    } else {
      summary.errors.push('campaigns: no Ad Account ID (set it in settings or META_AD_ACCOUNT_ID)');
    }

    if (cfg.pageId) {
      summary.pageSubscription = await step('page subscription', async () => {
        const r = await ensurePageSubscribed(cfg.pageId!);
        if (r.changed) await sequelize.query(`UPDATE crm_meta_settings SET webhook_subscribed_at = NOW() WHERE id = 1`);
        return r;
      });
      summary.forms = await step('forms', () => syncForms(cfg.pageId!));
      // After forms, so brand-new forms are known and mapped before their leads are processed.
      summary.backfill = await step('backfill', () => backfillMissedLeads(opts.backfillHours ?? 48));
    } else {
      summary.errors.push('forms: no Page ID (set it in settings or META_PAGE_ID)');
    }

    if (summary.errors.length) summary.ok = false;

    await sequelize.query(
      `UPDATE crm_meta_settings SET last_auto_sync_at = NOW(), last_auto_sync_summary = :s WHERE id = 1`,
      { replacements: { s: JSON.stringify(summary).slice(0, 8000) }, type: QueryTypes.UPDATE },
    );
    return summary;
  } finally {
    running = false;
  }
}
