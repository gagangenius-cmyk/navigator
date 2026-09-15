import { NextRequest, NextResponse } from 'next/server';
import { QueryTypes } from 'sequelize';
import { sequelize, connectDB } from '@/lib/sequelize';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { getMetaTokenStatus, setMetaPageAccessToken, setMetaConversionsAccessToken } from '@/lib/meta/token-store';

let dbReady = false;
async function ensureDB() {
  if (!dbReady) { await connectDB(); dbReady = true; }
}

export async function GET(request: NextRequest) {
  const auth = requireAuth(request, ['admin.access', 'marketing.manage']);
  if (isAuthError(auth)) return auth;
  await ensureDB();

  const [row] = await sequelize.query<{
    id: number;
    is_enabled: number;
    page_id: string;
    page_name: string;
    ad_account_id: string;
    graph_api_version: string;
    default_branch: string;
    default_lead_source: string;
    default_utm_source: string;
    last_webhook_at: string;
    last_campaign_sync_at: string;
    updated_at: string;
  }>(
    `SELECT id, is_enabled, page_id, page_name, ad_account_id, graph_api_version,
            default_branch, default_lead_source, default_utm_source,
            last_webhook_at, last_campaign_sync_at, updated_at
     FROM crm_meta_settings WHERE id = 1 LIMIT 1`,
    { type: QueryTypes.SELECT }
  );

  const tokenStatus = await getMetaTokenStatus();

  // Never expose token values — only where each one currently comes from
  return NextResponse.json({
    settings: row ?? null,
    tokenStatus,
    envStatus: {
      appId: process.env.META_APP_ID ? '✓ set' : '✗ missing',
      appSecret: process.env.META_APP_SECRET ? '✓ set' : '✗ missing',
      webhookVerifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN ? '✓ set' : '✗ missing',
      pageAccessToken: tokenStatus.pageTokenSource === 'missing' ? '✗ missing' : `✓ set (${tokenStatus.pageTokenSource})`,
      conversionsAccessToken: tokenStatus.conversionsTokenSource === 'missing' ? '✗ missing' : `✓ set (${tokenStatus.conversionsTokenSource})`,
      graphApiVersion: process.env.META_GRAPH_API_VERSION || 'v21.0 (default)',
      crmEndpoint: 'Direct database insert (no HTTP call)',
    },
  });
}

export async function PUT(request: NextRequest) {
  const auth = requireAuth(request, ['admin.access', 'marketing.manage']);
  if (isAuthError(auth)) return auth;
  await ensureDB();

  const body = await request.json() as {
    is_enabled?: number;
    page_id?: string;
    page_name?: string;
    ad_account_id?: string;
    graph_api_version?: string;
    default_branch?: string;
    default_lead_source?: string;
    default_utm_source?: string;
    page_access_token?: string;
    conversions_access_token?: string;
  };

  // Secret fields: only touch them when the form actually sent a new value —
  // an empty/omitted field means "leave the current token alone", not "clear
  // it", since the settings page never round-trips the real token back out.
  if (body.page_access_token?.trim()) {
    await setMetaPageAccessToken(body.page_access_token.trim());
  }
  if (body.conversions_access_token?.trim()) {
    await setMetaConversionsAccessToken(body.conversions_access_token.trim());
  }

  await sequelize.query(
    `UPDATE crm_meta_settings
     SET is_enabled          = :is_enabled,
         page_id             = :page_id,
         page_name           = :page_name,
         ad_account_id       = :ad_account_id,
         graph_api_version   = :graph_api_version,
         default_branch      = :default_branch,
         default_lead_source = :default_lead_source,
         default_utm_source  = :default_utm_source,
         updated_at          = NOW()
     WHERE id = 1`,
    {
      replacements: {
        is_enabled: body.is_enabled ?? 0,
        page_id: body.page_id ?? null,
        page_name: body.page_name ?? null,
        ad_account_id: body.ad_account_id ?? null,
        graph_api_version: body.graph_api_version || 'v21.0',
        default_branch: body.default_branch ?? null,
        default_lead_source: body.default_lead_source || 'Facebook Lead Ads',
        default_utm_source: body.default_utm_source || 'Facebook Lead Ads',
      },
      type: QueryTypes.UPDATE,
    }
  );

  return NextResponse.json({ success: true });
}
