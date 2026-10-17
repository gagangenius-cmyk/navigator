import { z } from 'zod';
import { CONTEXT_VARIABLE_KEYS, type ContextVariableKey } from './broadcastContextKeys';

// crm_broadcast_campaigns.variable_mapping: template variable name -> either
// a crm_forum_leads field to pull per-recipient, or a fixed value shared by
// every recipient in the campaign.

const LEAD_FIELD_ALLOWLIST = ['fname', 'lname', 'email', 'mobile', 'whatsapp_number'] as const;

export const variableMappingEntrySchema = z.discriminatedUnion('source', [
  z.object({ source: z.literal('lead_field'), field: z.enum(LEAD_FIELD_ALLOWLIST) }),
  z.object({ source: z.literal('static'), value: z.string() }),
  // Appointment / counselor / branch / balance values resolved per recipient at launch.
  z.object({ source: z.literal('context'), key: z.enum(CONTEXT_VARIABLE_KEYS) }),
]);

export const variableMappingSchema = z.record(z.string(), variableMappingEntrySchema);

export type VariableMappingEntry = z.infer<typeof variableMappingEntrySchema>;
export type VariableMapping = z.infer<typeof variableMappingSchema>;

type MinimalLead = Partial<Record<(typeof LEAD_FIELD_ALLOWLIST)[number], string | null>>;

// Resolves a campaign's variable_mapping against one lead's data, producing
// the values renderTemplateText() (src/lib/broadcastTemplateRender.ts)
// needs. A missing lead_field value is simply omitted (not an empty
// string), so renderTemplateText's own required-variable check is what
// actually surfaces a "this lead has no first name" problem, rather than
// this function silently rendering "Hi ,".
export function resolveVariableMapping(
  mapping: VariableMapping,
  lead: MinimalLead,
  context: Partial<Record<ContextVariableKey, string>> = {},
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [variableName, entry] of Object.entries(mapping)) {
    if (entry.source === 'static') {
      values[variableName] = entry.value;
      continue;
    }
    if (entry.source === 'context') {
      const contextValue = context[entry.key];
      if (contextValue) values[variableName] = contextValue;
      continue;
    }
    const fieldValue = lead[entry.field];
    if (fieldValue !== undefined && fieldValue !== null && fieldValue !== '') {
      values[variableName] = fieldValue;
    }
  }
  return values;
}

// Which crm_forum_leads column is this channel's send address.
export function resolveRecipientAddress(lead: MinimalLead, channel: 'email' | 'whatsapp' | 'sms'): string | null {
  if (channel === 'email') return lead.email || null;
  if (channel === 'whatsapp') return lead.whatsapp_number || lead.mobile || null;
  return lead.mobile || null;
}
