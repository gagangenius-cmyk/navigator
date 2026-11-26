// Search-box matching on a lead's phone numbers. Numbers are stored as typed ("+971 50-123 4567", "971501234567"),
// so a numeric search is also compared digit-by-digit, and a local "050..." finds "+97150..." too.
const COLUMNS = ['phone', 'mobile', 'whatsapp_number'];

/** Uses the caller's :search replacement ('%term%') and returns any extra replacements to merge in. */
export function leadPhoneSearch(search: string, alias = 'l'): { sql: string; replacements: Record<string, string> } {
  const conditions = COLUMNS.map((column) => `${alias}.${column} LIKE :search`);
  const replacements: Record<string, string> = {};
  const digits = search.replace(/\D/g, '').replace(/^0+/, '');
  if (digits.length >= 4 && /^[\d\s()+.-]+$/.test(search)) {
    for (const column of COLUMNS) {
      conditions.push(`REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(${alias}.${column}, ' ', ''), '-', ''), '+', ''), '(', ''), ')', '') LIKE :searchDigits`);
    }
    replacements.searchDigits = `%${digits}%`;
  }
  return { sql: conditions.join(' OR '), replacements };
}
