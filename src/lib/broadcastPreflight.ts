import crypto from 'crypto';

// Pure preflight logic for campaign launch (docs/broadcast-architecture.md
// section 6). Kept DB-free and side-effect-free on purpose so the
// compliance-critical rules here (never launch an unapproved WhatsApp
// template, never send to a suppressed or non-consenting recipient) can be
// unit tested directly, without a database, rather than only being
// exercised indirectly through an API route.

export interface TemplateApprovalCheckInput {
  channel: 'email' | 'whatsapp' | 'sms';
  status: 'draft' | 'pending_review' | 'approved' | 'rejected' | 'archived';
  providerTemplateId: string | null;
  currentPublishedVersionId: number | null;
}

export interface TemplateApprovalResult {
  approved: boolean;
  reason?: 'no_published_version' | 'not_approved' | 'whatsapp_missing_provider_id';
}

// The single compliance gate every campaign launch must pass:
// "Never let an unapproved WhatsApp template launch a business-initiated
// campaign." Email/SMS templates are considered "approved" once this CRM's
// own publish step marks them so (no external approval process exists for
// those channels) - WhatsApp additionally requires a real Meta
// provider_template_id, which nothing in this codebase can currently
// produce (no WABA submission integration yet - see
// docs/broadcast-architecture.md), so a WhatsApp campaign cannot pass this
// check until that integration exists and a template has actually been
// approved through it.
export function checkTemplateApprovedForLaunch(template: TemplateApprovalCheckInput): TemplateApprovalResult {
  if (!template.currentPublishedVersionId) {
    return { approved: false, reason: 'no_published_version' };
  }
  if (template.status !== 'approved') {
    return { approved: false, reason: 'not_approved' };
  }
  if (template.channel === 'whatsapp' && !template.providerTemplateId) {
    return { approved: false, reason: 'whatsapp_missing_provider_id' };
  }
  return { approved: true };
}

export interface RecipientEligibilityInput {
  purpose: 'marketing' | 'transactional';
  consentState: 'opted_in' | 'opted_out' | 'unknown';
  isSuppressed: boolean;
}

export interface RecipientEligibilityResult {
  eligible: boolean;
  reason?: 'suppressed' | 'opted_out' | 'no_consent';
}

// Default consent policy: a suppressed address or an explicit opt-out is
// always excluded, for any purpose. A 'marketing' send additionally
// requires an explicit prior opt-in (the safe default under most
// jurisdictions' marketing-consent rules); a 'transactional' send only
// needs the absence of an opt-out (typical carve-out for service-related
// messages - case updates, OTPs, appointment reminders). This is a
// documented default, not a legal determination for this business - review
// with product/legal before relying on it for a specific jurisdiction, per
// the originating spec's own instruction to define retention/consent/
// privacy requirements "with product/legal review."
export function isRecipientEligible(input: RecipientEligibilityInput): RecipientEligibilityResult {
  if (input.isSuppressed) return { eligible: false, reason: 'suppressed' };
  if (input.consentState === 'opted_out') return { eligible: false, reason: 'opted_out' };
  if (input.purpose === 'marketing' && input.consentState !== 'opted_in') {
    return { eligible: false, reason: 'no_consent' };
  }
  return { eligible: true };
}

// Hash of the frozen launch configuration (crm_broadcast_campaigns.published_config_hash) -
// set once when a campaign leaves 'draft' and never recomputed afterward,
// so two campaigns launched from the same template+segment+mapping are
// still distinguishable as separate launches, and so a bug that somehow let
// code mutate a launched campaign's config is at least detectable.
export function computePublishedConfigHash(config: {
  templateVersionId: number;
  segmentId: number | null;
  variableMapping: unknown;
  scheduledAtUtc: string | null;
}): string {
  return crypto.createHash('sha256').update(JSON.stringify(config), 'utf8').digest('hex');
}
