/**
 * Click-to-WhatsApp (CTWA) ad leads -> CRM.
 *
 * Lead Ads forms arrive through /api/webhooks/meta (processor.ts). A CTWA ad
 * has no form: the person taps the ad, WhatsApp opens, and their first message
 * reaches /api/webhooks/whatsapp carrying a `referral` block (ad id, click id,
 * headline). That block is the only attribution Meta ever gives us, so it is
 * captured here at the moment it arrives:
 *
 *  - unknown number  -> a new CRM lead, tagged with the ad/adset/campaign
 *  - known number    -> no new lead; the ad touch is logged on the existing one
 *
 * Every referral is recorded in crm_meta_ctwa_leads, keyed on the WhatsApp
 * message id, so Meta's webhook redeliveries are idempotent.
 */

import { QueryTypes } from 'sequelize';
import { sequelize } from '@/lib/sequelize';
import { ingestWebToLead } from '@/lib/webToLeadsIngest';
import { findLeadIdByPhone } from '@/lib/phoneLookup';
import { logLeadRemark } from '@/lib/leadRemarks';
import { ensureMetaCampaignNameColumn } from '@/lib/ensureMetaCampaignNameColumn';
import { fetchAdDetails, type MetaAdDetails } from './graph-api';
import type { WhatsAppInboundMessage } from '@/lib/whatsappWebhook';

// crm_source row names. 'WhatsApp Ads' is the dedicated source; the Lead Ads
// source is the fallback if that row has been renamed/removed.
const PRIMARY_SOURCE = 'WhatsApp Ads';
const FALLBACK_SOURCE = 'Meta (Facebook/Instagram)';

// Dial-code prefix -> resident country. Only the markets that have their own
// branch (see branchResolver.ts); anything else is treated as UAE.
const DIAL_CODES: Array<[string, string]> = [
  ['971', 'UAE'],
  ['974', 'Qatar'],
  ['965', 'Kuwait'],
  ['91', 'India'],
];

let schemaReady: Promise<void> | null = null;
export function ensureCtwaSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = sequelize.query(`
      CREATE TABLE IF NOT EXISTS crm_meta_ctwa_leads (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        provider_message_id VARCHAR(191) NOT NULL,
        phone VARCHAR(32) NOT NULL,
        profile_name VARCHAR(255) NULL,
        ctwa_clid VARCHAR(512) NULL,
        source_type VARCHAR(32) NULL,
        source_id VARCHAR(64) NULL,
        source_url VARCHAR(1024) NULL,
        headline VARCHAR(512) NULL,
        ad_body TEXT NULL,
        media_type VARCHAR(32) NULL,
        media_url VARCHAR(1024) NULL,
        campaign_id VARCHAR(64) NULL,
        campaign_name VARCHAR(255) NULL,
        adset_name VARCHAR(255) NULL,
        ad_name VARCHAR(255) NULL,
        first_message TEXT NULL,
        lead_id INT NULL,
        is_new_lead TINYINT(1) NOT NULL DEFAULT 0,
        status VARCHAR(16) NOT NULL DEFAULT 'processing',
        error_message TEXT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_ctwa_message (provider_message_id),
        KEY idx_ctwa_lead (lead_id),
        KEY idx_ctwa_campaign (campaign_id),
        KEY idx_ctwa_source (source_id),
        KEY idx_ctwa_phone (phone),
        KEY idx_ctwa_created (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `).then(() => undefined).catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

export function residentCountryForPhone(digits: string): string {
  for (const [prefix, country] of DIAL_CODES) {
    if (digits.startsWith(prefix)) return country;
  }
  return 'UAE';
}

async function integrationEnabled(): Promise<boolean> {
  const [row] = await sequelize.query<{ is_enabled: number }>(
    `SELECT is_enabled FROM crm_meta_settings WHERE id = 1 LIMIT 1`,
    { type: QueryTypes.SELECT },
  );
  return !!row?.is_enabled;
}

async function updateRecord(id: number, fields: Record<string, unknown>) {
  const sets = Object.keys(fields).map((k) => `${k} = :${k}`).join(', ');
  await sequelize.query(`UPDATE crm_meta_ctwa_leads SET ${sets} WHERE id = :id`, {
    replacements: { ...fields, id },
    type: QueryTypes.UPDATE,
  });
}

export interface CtwaResult {
  handled: boolean;
  leadId: number | null;
  isNewLead: boolean;
}

/**
 * Handles one inbound WhatsApp message. No-op (handled: false) unless it
 * carries a Click-to-WhatsApp referral. Never throws: the WhatsApp webhook
 * must keep processing the same message (bot/broadcast flows) regardless.
 */
export async function handleCtwaMessage(message: WhatsAppInboundMessage): Promise<CtwaResult> {
  const none: CtwaResult = { handled: false, leadId: null, isNewLead: false };
  const referral = message.referral;
  if (!referral) return none;

  let recordId: number | null = null;
  try {
    await ensureCtwaSchema();
    if (!(await integrationEnabled())) return none;

    const digits = message.from.replace(/\D/g, '');

    // Claim the message first; a redelivered webhook loses this INSERT and stops.
    const [insertId, affected] = await sequelize.query(
      `INSERT IGNORE INTO crm_meta_ctwa_leads
         (provider_message_id, phone, profile_name, ctwa_clid, source_type, source_id, source_url,
          headline, ad_body, media_type, media_url, first_message, status)
       VALUES
         (:messageId, :phone, :profileName, :clid, :sourceType, :sourceId, :sourceUrl,
          :headline, :adBody, :mediaType, :mediaUrl, :firstMessage, 'processing')`,
      {
        replacements: {
          messageId: message.providerMessageId,
          phone: digits,
          profileName: message.profileName?.slice(0, 255) ?? null,
          clid: referral.ctwaClid?.slice(0, 512) ?? null,
          sourceType: referral.sourceType?.slice(0, 32) ?? null,
          sourceId: referral.sourceId?.slice(0, 64) ?? null,
          sourceUrl: referral.sourceUrl?.slice(0, 1024) ?? null,
          headline: referral.headline?.slice(0, 512) ?? null,
          adBody: referral.body,
          mediaType: referral.mediaType?.slice(0, 32) ?? null,
          mediaUrl: referral.mediaUrl?.slice(0, 1024) ?? null,
          firstMessage: message.text,
        },
        type: QueryTypes.INSERT,
      },
    ) as unknown as [number, number];
    if (!affected) return { handled: true, leadId: null, isNewLead: false }; // duplicate delivery
    recordId = insertId;

    let ad: MetaAdDetails | null = null;
    if (referral.sourceId && referral.sourceType !== 'post') {
      ad = await fetchAdDetails(referral.sourceId);
    }
    const campaignName = ad?.campaignName ?? referral.headline ?? null;

    await updateRecord(recordId, {
      campaign_id: ad?.campaignId ?? null,
      campaign_name: ad?.campaignName?.slice(0, 255) ?? null,
      adset_name: ad?.adsetName?.slice(0, 255) ?? null,
      ad_name: ad?.adName?.slice(0, 255) ?? null,
    });

    const attribution = [
      campaignName && `Campaign: ${campaignName}`,
      ad?.adsetName && `Ad set: ${ad.adsetName}`,
      ad?.adName && `Ad: ${ad.adName}`,
      !ad?.adName && referral.headline && `Ad headline: ${referral.headline}`,
      referral.sourceId && `Ad ID: ${referral.sourceId}`,
      referral.sourceUrl && `Ad link: ${referral.sourceUrl}`,
      message.text && `First message: ${message.text}`,
    ].filter(Boolean).join('\n');

    // Existing contact: record the ad touch, don't create a second lead.
    const existingId = await findLeadIdByPhone(digits);
    if (existingId) {
      await logLeadRemark({
        leadId: existingId,
        action: 'remark_added',
        remark: `Re-engaged via Click-to-WhatsApp ad.\n${attribution}`,
        actorRole: 'System (Click-to-WhatsApp)',
      });
      await updateRecord(recordId, { lead_id: existingId, is_new_lead: 0, status: 'attributed' });
      return { handled: true, leadId: existingId, isNewLead: false };
    }

    const base = {
      lastName: message.profileName?.trim() || `WhatsApp +${digits}`,
      phone: `+${digits}`,
      ResidentCountry: residentCountryForPhone(digits),
      UTMSource: 'Click-to-WhatsApp Ad',
      // Unassigned unless an active assignment rule matches (campaign-aware),
      // same policy as Lead Ads leads.
      roundrobin: 'rules',
      CampaignName: campaignName ?? '',
      FormName: 'Click-to-WhatsApp',
      AdditionalInfo: attribution,
    };
    const ctx = { host: 'whatsapp-webhook', allowMissingEmail: true };

    let result = await ingestWebToLead({ ...base, LeadSource: PRIMARY_SOURCE }, ctx);
    if (!result.success && result.status === 422) {
      result = await ingestWebToLead({ ...base, LeadSource: FALLBACK_SOURCE }, ctx);
    }
    if (!result.success || !result.leadId) {
      await updateRecord(recordId, { status: 'failed', error_message: (result.error ?? 'Lead creation failed').slice(0, 1000) });
      return { handled: true, leadId: null, isNewLead: false };
    }

    // Best-effort enrichment - the lead already exists, never fail on these.
    await sequelize.query(
      `UPDATE crm_forum_leads SET whatsapp_number = :phone WHERE id = :id`,
      { replacements: { phone: `+${digits}`, id: result.leadId }, type: QueryTypes.UPDATE },
    ).catch(() => {});
    if (campaignName) {
      await ensureMetaCampaignNameColumn()
        .then(() => sequelize.query(
          `UPDATE crm_forum_leads SET meta_campaign_name = :name WHERE id = :id`,
          { replacements: { name: campaignName.slice(0, 255), id: result.leadId }, type: QueryTypes.UPDATE },
        ))
        .catch(() => {});
    }

    await updateRecord(recordId, { lead_id: result.leadId, is_new_lead: 1, status: 'created' });
    return { handled: true, leadId: result.leadId, isNewLead: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[CTWA] Failed to process referral message:', msg);
    if (recordId) await updateRecord(recordId, { status: 'failed', error_message: msg.slice(0, 1000) }).catch(() => {});
    return none;
  }
}
