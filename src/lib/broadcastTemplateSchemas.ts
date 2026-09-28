import { z } from 'zod';

// Zod schemas for crm_message_template_versions.components (the structured,
// channel-specific body persisted per docs/broadcast-architecture.md). These
// validate what a Phase 2 template-editor API route accepts - never used to
// validate Unlayer's own design_json, which is an opaque third-party format
// stored as-is (see emailTemplateComponentsSchema's designJson field below).
//
// Variable tokens are written `{{name}}` for every channel. WhatsApp's real
// provider constraint (Meta Cloud API) only allows positional numeric names
// in body text ("{{1}}", "{{2}}", ...) - email/SMS use readable names
// ("{{first_name}}"). extractVariableTokens() in broadcastTemplateRender.ts
// matches both with one regex since \w covers digits and letters alike.

const variableTokenName = /^[a-zA-Z0-9_]+$/;

export const templateVariableDefinitionSchema = z.object({
  name: z.string().min(1).regex(variableTokenName, 'Variable name must be alphanumeric/underscore only, matching the {{name}} token it stands for'),
  type: z.enum(['string', 'number', 'date']).default('string'),
  required: z.boolean().default(true),
  sample: z.string().optional(),
});

export const templateVariableSchemaArray = z.array(templateVariableDefinitionSchema);

// ── WhatsApp (Meta Cloud API template component model) ──────────────────────
const whatsappHeaderSchema = z.object({
  format: z.enum(['TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT']),
  // Meta allows at most one {{1}} variable in a TEXT header, never in an
  // IMAGE/VIDEO/DOCUMENT header (those attach media instead).
  text: z.string().max(60).optional(),
}).refine(
  (header) => header.format === 'TEXT' || header.text === undefined,
  { message: 'Only a TEXT header may carry a text field' }
);

const whatsappButtonSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('QUICK_REPLY'), text: z.string().min(1).max(25) }),
  // Meta allows exactly one trailing {{1}} at the end of a dynamic URL button's url.
  z.object({ type: z.literal('URL'), text: z.string().min(1).max(25), url: z.string().url().max(2000) }),
  z.object({ type: z.literal('PHONE_NUMBER'), text: z.string().min(1).max(25), phoneNumber: z.string().min(1).max(20) }),
]);

export const whatsappTemplateComponentsSchema = z.object({
  header: whatsappHeaderSchema.optional(),
  body: z.object({ text: z.string().min(1).max(1024) }),
  footer: z.object({ text: z.string().min(1).max(60) }).optional(),
  // Meta's own cap is 10 buttons total, with format-specific sub-limits
  // (e.g. at most 1 URL + 1 PHONE_NUMBER when mixed with quick replies) that
  // shift with provider policy - enforcing only the hard structural cap
  // here and leaving the finer provider-specific mix rules to the Phase 2
  // WhatsApp editor's own preview/validation, which can stay current with
  // Meta's docs without a schema migration.
  buttons: z.array(whatsappButtonSchema).max(10).optional(),
});

// ── Email ─────────────────────────────────────────────────────────────────
export const emailTemplateComponentsSchema = z.object({
  subject: z.string().min(1).max(255),
  preheader: z.string().max(255).optional(),
  // Unlayer's design JSON is stored verbatim as the canonical editable
  // source (docs/broadcast-architecture.md / the originating spec's Unlayer
  // requirement) - this schema only checks it's an object, never its shape.
  designJson: z.record(z.string(), z.unknown()).optional(),
});

// ── SMS ───────────────────────────────────────────────────────────────────
export const smsTemplateComponentsSchema = z.object({
  text: z.string().min(1).max(1600), // ~10 GSM-7 segments; see estimateSmsSegments for the real per-send cost
});

export function componentsSchemaForChannel(channel: 'email' | 'whatsapp' | 'sms') {
  if (channel === 'whatsapp') return whatsappTemplateComponentsSchema;
  if (channel === 'sms') return smsTemplateComponentsSchema;
  return emailTemplateComponentsSchema;
}

export type WhatsappTemplateComponents = z.infer<typeof whatsappTemplateComponentsSchema>;
export type EmailTemplateComponents = z.infer<typeof emailTemplateComponentsSchema>;
export type SmsTemplateComponents = z.infer<typeof smsTemplateComponentsSchema>;
export type TemplateVariableDefinition = z.infer<typeof templateVariableDefinitionSchema>;
