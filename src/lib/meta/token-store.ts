/**
 * Dynamic, DB-backed storage for Meta access tokens.
 *
 * Page/Conversions API access tokens rotate and expire — storing them only
 * in .env meant every rotation needed a redeploy. Tokens are now editable
 * from /admin/meta-leads/settings and stored encrypted (AES-256-GCM, see
 * src/lib/encryption.ts — the same scheme already used for MFA secrets) in
 * crm_meta_settings. The corresponding META_PAGE_ACCESS_TOKEN /
 * META_CONVERSIONS_ACCESS_TOKEN env vars still work as a fallback, mainly so
 * a fresh environment isn't broken before anyone has used the settings page.
 */

import { QueryTypes } from 'sequelize';
import { sequelize } from '@/lib/sequelize';
import { encryptSecret, decryptSecret } from '@/lib/encryption';

interface TokenRow {
  page_access_token_encrypted: string | null;
  conversions_access_token_encrypted: string | null;
  token_updated_at: string | null;
}

// Short-lived in-memory cache — webhook processing can call these more than
// once per lead (fetchLeadFromMeta + fetchFormName), and this is on the hot
// path of every inbound lead, so avoid a DB round trip for each call.
const CACHE_TTL_MS = 30_000;
let cache: { row: TokenRow | null; loadedAt: number } | null = null;

async function loadRow(): Promise<TokenRow | null> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
    return cache.row;
  }
  const [row] = await sequelize.query<TokenRow>(
    `SELECT page_access_token_encrypted, conversions_access_token_encrypted, token_updated_at
     FROM crm_meta_settings WHERE id = 1 LIMIT 1`,
    { type: QueryTypes.SELECT },
  );
  cache = { row: row ?? null, loadedAt: Date.now() };
  return cache.row;
}

function invalidateCache() {
  cache = null;
}

export async function getMetaPageAccessToken(): Promise<string> {
  const row = await loadRow();
  if (row?.page_access_token_encrypted) {
    return decryptSecret(row.page_access_token_encrypted);
  }
  const envToken = process.env.META_PAGE_ACCESS_TOKEN;
  if (envToken) return envToken;
  throw new Error('No Meta Page Access Token configured — set it in /admin/meta-leads/settings or META_PAGE_ACCESS_TOKEN');
}

export async function getMetaConversionsAccessToken(): Promise<string> {
  const row = await loadRow();
  // Conversions API can reuse the Page token when no dedicated one is set —
  // DB values take priority over env vars at each step.
  if (row?.conversions_access_token_encrypted) {
    return decryptSecret(row.conversions_access_token_encrypted);
  }
  if (row?.page_access_token_encrypted) {
    return decryptSecret(row.page_access_token_encrypted);
  }
  const envToken = process.env.META_CONVERSIONS_ACCESS_TOKEN || process.env.META_PAGE_ACCESS_TOKEN;
  if (envToken) return envToken;
  throw new Error('No Meta Conversions API access token configured — set it in /admin/meta-leads/settings or META_CONVERSIONS_ACCESS_TOKEN/META_PAGE_ACCESS_TOKEN');
}

export async function setMetaPageAccessToken(plainToken: string): Promise<void> {
  await sequelize.query(
    `UPDATE crm_meta_settings SET page_access_token_encrypted = :token, token_updated_at = NOW() WHERE id = 1`,
    { replacements: { token: encryptSecret(plainToken) }, type: QueryTypes.UPDATE },
  );
  invalidateCache();
}

export async function setMetaConversionsAccessToken(plainToken: string): Promise<void> {
  await sequelize.query(
    `UPDATE crm_meta_settings SET conversions_access_token_encrypted = :token, token_updated_at = NOW() WHERE id = 1`,
    { replacements: { token: encryptSecret(plainToken) }, type: QueryTypes.UPDATE },
  );
  invalidateCache();
}

export interface MetaTokenStatus {
  pageTokenSource: 'database' | 'env' | 'missing';
  conversionsTokenSource: 'database' | 'env' | 'missing';
  tokenUpdatedAt: string | null;
}

export async function getMetaTokenStatus(): Promise<MetaTokenStatus> {
  const row = await loadRow();

  const pageTokenSource: MetaTokenStatus['pageTokenSource'] = row?.page_access_token_encrypted
    ? 'database'
    : process.env.META_PAGE_ACCESS_TOKEN ? 'env' : 'missing';

  const conversionsTokenSource: MetaTokenStatus['conversionsTokenSource'] = row?.conversions_access_token_encrypted
    ? 'database'
    : row?.page_access_token_encrypted
      ? 'database'
      : (process.env.META_CONVERSIONS_ACCESS_TOKEN || process.env.META_PAGE_ACCESS_TOKEN)
        ? 'env'
        : 'missing';

  return {
    pageTokenSource,
    conversionsTokenSource,
    tokenUpdatedAt: row?.token_updated_at ?? null,
  };
}
