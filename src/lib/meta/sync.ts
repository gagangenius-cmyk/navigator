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

export async function syncCampaigns(adAccountId: string): Promise<{ synced: number }> {
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

  await sequelize.query(
    `UPDATE crm_meta_campaign_cache c
     SET c.leads_count = (SELECT COUNT(*) FROM crm_meta_leads ml WHERE ml.campaign_id = c.campaign_id)`,
    { type: QueryTypes.UPDATE },
  );
  await sequelize.query(`UPDATE crm_meta_settings SET last_campaign_sync_at = NOW() WHERE id = 1`, { type: QueryTypes.UPDATE });
  return { synced: campaigns.length };
}

// ── Forms + auto mapping ─────────────────────────────────────────────────────

/** Upserts one form and creates any missing FORM-scope mappings for its questions. */
export async function upsertFormAndMappings(
  form: MetaLeadForm,
  pageId: string | null,
): Promise<{ isNew: boolean; mappingsCreated: number }> {
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

  return { isNew: !existing, mappingsCreated };
}

export async function syncForms(pageId: string): Promise<{ forms: number; newForms: number; mappingsCreated: number }> {
  const forms = await fetchPageLeadForms(pageId);
  let newForms = 0;
  let mappingsCreated = 0;
  for (const form of forms) {
    const r = await upsertFormAndMappings(form, pageId);
    if (r.isNew) newForms++;
    mappingsCreated += r.mappingsCreated;
  }
  return { forms: forms.length, newForms, mappingsCreated };
}

/**
 * Called by the lead processor before it builds a payload: if this form has
 * never been seen (brand new form, webhook arrived before any cron run) it is
 * fetched and auto-mapped on the spot. Returns the form name when known.
 * Best-effort - never throws.
 */
export async function ensureFormSynced(formId: string, pageId: string | null): Promise<string | null> {
  try {
    await ensureMetaSyncSchema();
    const [known] = await sequelize.query<{ form_name: string | null }>(
      `SELECT form_name FROM crm_meta_forms WHERE form_id = :formId LIMIT 1`,
      { replacements: { formId }, type: QueryTypes.SELECT },
    );
    if (known) return known.form_name;

    const form = await fetchLeadForm(formId);
    if (!form) return null;
    await upsertFormAndMappings(form, pageId);
    return form.name ?? null;
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
  campaigns?: { synced: number };
  forms?: { forms: number; newForms: number; mappingsCreated: number };
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
