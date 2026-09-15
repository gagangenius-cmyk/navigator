/**
 * Orchestrates sending a lead's CRM-assigned "Meta Lead Quality" back to
 * Meta via the Conversions API, whenever an agent sets it on a lead that
 * originated from Meta Lead Ads (crm_forum_leads.meta_leadgen_id is set).
 *
 * Called fire-and-forget from the lead update routes — it must never throw
 * or block the caller's own DB transaction; every failure is swallowed and
 * logged to crm_meta_quality_events instead.
 */

import { QueryTypes } from 'sequelize';
import { sequelize } from '@/lib/sequelize';
import { sendLeadConversionEvent } from './conversions-api';

interface QualityMappingRow {
  meta_event_name: string;
  meta_value: string | number | null;
  meta_currency: string | null;
}

export interface NotifyResult {
  sent: boolean;
  reason?: string;
}

/**
 * @param leadId crm_forum_leads.id
 * @param qualityLabel one of crm_meta_quality_mappings.quality_label (e.g. "Qualified")
 */
export async function notifyMetaLeadQuality(leadId: number, qualityLabel: string): Promise<NotifyResult> {
  try {
    const [lead] = await sequelize.query<{ meta_leadgen_id: string | null }>(
      'SELECT meta_leadgen_id FROM crm_forum_leads WHERE id = :leadId LIMIT 1',
      { replacements: { leadId }, type: QueryTypes.SELECT },
    );

    if (!lead?.meta_leadgen_id) {
      return { sent: false, reason: 'Lead did not originate from Meta Lead Ads (no meta_leadgen_id)' };
    }

    const [mapping] = await sequelize.query<QualityMappingRow>(
      `SELECT meta_event_name, meta_value, meta_currency
       FROM crm_meta_quality_mappings
       WHERE quality_label = :qualityLabel AND is_enabled = 1
       LIMIT 1`,
      { replacements: { qualityLabel }, type: QueryTypes.SELECT },
    );

    if (!mapping) {
      return { sent: false, reason: `No enabled Meta event mapping for quality "${qualityLabel}"` };
    }

    const result = await sendLeadConversionEvent(lead.meta_leadgen_id, mapping.meta_event_name, {
      value: mapping.meta_value != null ? Number(mapping.meta_value) : null,
      currency: mapping.meta_currency,
    });

    await sequelize.query(
      `INSERT INTO crm_meta_quality_events
         (lead_id, meta_leadgen_id, quality_label, meta_event_name,
          request_payload, response_status, response_body, success, error_message)
       VALUES
         (:leadId, :leadgenId, :qualityLabel, :eventName,
          :requestPayload, :responseStatus, :responseBody, :success, :errorMessage)`,
      {
        replacements: {
          leadId,
          leadgenId: lead.meta_leadgen_id,
          qualityLabel,
          eventName: mapping.meta_event_name,
          requestPayload: JSON.stringify(result.requestPayload),
          responseStatus: result.status,
          responseBody: result.body,
          success: result.success ? 1 : 0,
          errorMessage: result.error,
        },
        type: QueryTypes.INSERT,
      },
    );

    return { sent: result.success, reason: result.error ?? undefined };
  } catch (err) {
    console.error(`[Meta Quality Feedback] Failed for lead ${leadId} (${qualityLabel}):`, err);
    return { sent: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
