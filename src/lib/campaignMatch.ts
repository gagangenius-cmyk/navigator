/**
 * Campaign-name matching shared by the assignment-rule engine and the Leads list.
 *
 * Campaign names are free text typed by marketing in Meta Ads Manager
 * ("Norway-Uae-Saudi", "UAE | Skilled  Workers"), so exact comparison breaks on
 * stray spaces, case and separator differences. Names are compared in a
 * normalised form, and a rule can use `*` as a wildcard ("norway*", "*saudi*")
 * to cover a whole family of campaigns without listing each one.
 */

/** Lower-case, trim, and treat runs of whitespace / - / _ / | as one separator. */
export function normalizeCampaign(value: string | null | undefined): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\s\-_|]+/g, ' ')
    .trim();
}

const escapeRegex = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

/** True when `value` equals one of `patterns` (after normalisation), honouring `*` wildcards. */
export function campaignMatches(patterns: string[], value: string | null | undefined): boolean {
  const target = normalizeCampaign(value);
  if (!target) return false;
  return patterns.some((pattern) => {
    // Normalise each wildcard-separated piece so "*" survives the separator collapsing.
    const pieces = pattern.split('*').map(normalizeCampaign);
    if (pieces.length === 1) return pieces[0] !== '' && pieces[0] === target;
    if (pieces.every((piece) => piece === '')) return false;
    const re = new RegExp(`^${pieces.map(escapeRegex).join('.*')}$`);
    return re.test(target);
  });
}
