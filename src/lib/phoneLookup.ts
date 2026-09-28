import { QueryTypes } from 'sequelize';
import { sequelize } from './sequelize';

// Matches an inbound message's sender phone number back to a
// crm_forum_leads row, tolerant of formatting differences (+, spaces,
// leading 00 vs +) between what Meta sends (digits only, e.g.
// "971501234567") and however the number was originally typed into the
// lead form. Compares the last 9 significant digits (enough to
// disambiguate within one country's numbering plan without needing a
// full E.164 normalization library) via RIGHT()/REPLACE() in SQL rather
// than fetching every lead into JS.
export async function findLeadIdByPhone(phone: string): Promise<number | null> {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 9) return null;
  const tail = digits.slice(-9);

  const rows = await sequelize.query<{ id: number }>(
    `SELECT id FROM crm_forum_leads
     WHERE RIGHT(REPLACE(REPLACE(REPLACE(whatsapp_number, ' ', ''), '+', ''), '-', ''), 9) = :tail
        OR RIGHT(REPLACE(REPLACE(REPLACE(mobile, ' ', ''), '+', ''), '-', ''), 9) = :tail
     ORDER BY id DESC
     LIMIT 1`,
    { replacements: { tail }, type: QueryTypes.SELECT }
  );
  return rows[0]?.id ?? null;
}
