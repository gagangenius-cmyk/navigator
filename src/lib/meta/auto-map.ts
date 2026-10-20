/**
 * Suggests which CRM field a Meta Instant Form question should map to.
 *
 * Pure (no I/O) so it is unit-testable. Meta's standard question types are
 * trusted first; custom questions are matched on their key + label text.
 * Anything not recognised returns null and still reaches the CRM through the
 * "AdditionalInfo" catch-all in mapping-engine.ts, so no answer is dropped.
 */

import type { MetaFormQuestion } from './types';

/** Same normalisation parseFieldData() applies to incoming field_data names. */
export const normalizeFieldKey = (key: string): string => key.toLowerCase().replace(/[\s-]/g, '_');

// Standard Meta types already covered by the GLOBAL default mappings or derived
// from other fields (first/last name are joined into the full name).
const STANDARD_TYPE_TO_CRM: Record<string, string | null> = {
  FULL_NAME: 'lastName',
  EMAIL: 'email',
  PHONE: 'phone',
  COUNTRY: 'ResidentCountry',
  FIRST_NAME: null,
  LAST_NAME: null,
};

// Order matters: most specific first ("country you want to move to" must win
// over the generic "country" residence rule).
const LABEL_RULES: Array<[RegExp, string]> = [
  [/destination|move[_ ]to|migrat\w*[_ ]to|settle[_ ]in|study[_ ]in|work[_ ]in|country[_ ]of[_ ]interest|interested[_ ]country|which[_ ]country.*(want|interest|apply|prefer)/, 'DestinationCountry'],
  [/\bage\b|age[_ ]?range|how[_ ]old/, 'AgeRange'],
  [/educat|qualif|degree|highest[_ ]level|graduat/, 'Education'],
  [/branch|nearest[_ ]office|preferred[_ ]office|office[_ ]location/, 'Branch'],
  [/resid|living[_ ]in|currently[_ ]in|where[_ ]do[_ ]you[_ ]live|nationality|your[_ ]country|country[_ ]of/, 'ResidentCountry'],
  [/visa|immigra|program|service|looking[_ ]for|interested[_ ]in|purpose|\bpr\b|permanent|sponsor/, 'ImmigrationType'],
];

export function suggestCrmField(q: MetaFormQuestion): string | null {
  const type = (q.type || '').toUpperCase();
  if (type in STANDARD_TYPE_TO_CRM) return STANDARD_TYPE_TO_CRM[type];

  const text = `${q.key} ${q.label ?? ''}`.toLowerCase();
  for (const [pattern, crmField] of LABEL_RULES) {
    if (pattern.test(text)) return crmField;
  }
  return null;
}

export interface SuggestedMapping {
  metaFieldKey: string;
  crmFieldKey: string;
}

/**
 * Suggestions for a whole form. Each CRM field is claimed by at most one
 * question (first match wins) so two questions never fight over the same target.
 */
export function suggestMappingsForForm(questions: MetaFormQuestion[]): SuggestedMapping[] {
  const claimed = new Set<string>();
  const out: SuggestedMapping[] = [];
  for (const q of questions) {
    if (!q?.key) continue;
    const crm = suggestCrmField(q);
    if (!crm || claimed.has(crm)) continue;
    claimed.add(crm);
    out.push({ metaFieldKey: normalizeFieldKey(q.key), crmFieldKey: crm });
  }
  return out;
}
