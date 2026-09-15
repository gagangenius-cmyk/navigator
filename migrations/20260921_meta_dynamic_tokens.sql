-- Lets Meta Page/Conversions API access tokens be rotated from
-- /admin/meta-leads/settings instead of requiring a redeploy to change an
-- env var. Stored AES-256-GCM encrypted (see src/lib/encryption.ts, the same
-- scheme already used for MFA secrets) via src/lib/meta/token-store.ts,
-- which falls back to META_PAGE_ACCESS_TOKEN / META_CONVERSIONS_ACCESS_TOKEN
-- when these are empty so a fresh environment isn't broken before anyone
-- has used the settings page.
ALTER TABLE crm_meta_settings
  ADD COLUMN page_access_token_encrypted TEXT NULL AFTER graph_api_version,
  ADD COLUMN conversions_access_token_encrypted TEXT NULL AFTER page_access_token_encrypted,
  ADD COLUMN token_updated_at DATETIME NULL AFTER conversions_access_token_encrypted;
