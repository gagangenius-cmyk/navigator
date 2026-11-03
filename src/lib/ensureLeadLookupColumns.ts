import { sequelize } from '@/lib/sequelize';

/**
 * Indexed, normalised phone/email for duplicate detection.
 *
 * checkForDuplicate used to compare `REPLACE(REPLACE(...phone...)) = ?` and
 * `LOWER(email) = ?`: wrapping the column in functions makes the predicate
 * non-sargable, so every inbound lead scanned the whole table. These VIRTUAL
 * generated columns hold the exact same normalisation and carry an index, so
 * the lookup becomes an index seek. They cost no storage for the value itself,
 * are maintained by MySQL, and are deliberately not declared on the Sequelize
 * model so databases that have not been touched yet cannot break model queries.
 *
 * Added lazily (same pattern as ensureMetaCampaignNameColumn). Resolves to
 * false when the columns cannot be provisioned (e.g. an engine without
 * generated-column support) so callers fall back to the original expressions.
 */

export const PHONE_NORM_EXPR =
  "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(phone,''), '+', ''), '-', ''), ' ', ''), '(', ''), ')', ''), '.', '')";
export const EMAIL_NORM_EXPR = "LOWER(COALESCE(email,''))";

let ready: Promise<boolean> | null = null;

async function columnExists(name: string): Promise<boolean> {
  const [rows] = await sequelize.query(
    `SELECT COUNT(*) AS cnt FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'crm_forum_leads' AND COLUMN_NAME = '${name}'`
  );
  return Number((rows as Array<{ cnt: number }>)?.[0]?.cnt || 0) > 0;
}

export function ensureLeadLookupColumns(): Promise<boolean> {
  if (!ready) {
    ready = (async () => {
      try {
        if (!(await columnExists('phone_norm'))) {
          await sequelize.query(
            `ALTER TABLE crm_forum_leads
               ADD COLUMN phone_norm VARCHAR(555) GENERATED ALWAYS AS (${PHONE_NORM_EXPR}) VIRTUAL,
               ADD INDEX idx_forum_leads_phone_norm (phone_norm(64))`
          );
        }
        if (!(await columnExists('email_norm'))) {
          await sequelize.query(
            `ALTER TABLE crm_forum_leads
               ADD COLUMN email_norm VARCHAR(555) GENERATED ALWAYS AS (${EMAIL_NORM_EXPR}) VIRTUAL,
               ADD INDEX idx_forum_leads_email_norm (email_norm(191))`
          );
        }
        return true;
      } catch (error) {
        console.error('[duplicate-check] Could not provision indexed lookup columns, using slow path:', error);
        return false;
      }
    })();
  }
  return ready;
}
