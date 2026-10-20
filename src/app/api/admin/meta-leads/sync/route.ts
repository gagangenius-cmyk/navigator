import { NextRequest, NextResponse } from 'next/server';
import { QueryTypes } from 'sequelize';
import { sequelize, connectDB } from '@/lib/sequelize';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { runMetaAutoSync, ensureMetaSyncSchema, getMetaSyncConfig } from '@/lib/meta/sync';
import { inspectPageToken } from '@/lib/meta/graph-api';

export const maxDuration = 300;

let dbReady = false;
async function ensureDB() {
  if (!dbReady) { await connectDB(); dbReady = true; }
}

/** GET - auto-sync status: last run, discovered forms, token health. */
export async function GET(request: NextRequest) {
  const auth = requireAuth(request, ['admin.access', 'marketing.manage']);
  if (isAuthError(auth)) return auth;
  await ensureDB();
  await ensureMetaSyncSchema();

  const [settings] = await sequelize.query<{
    last_auto_sync_at: string | null;
    last_auto_sync_summary: string | null;
    last_campaign_sync_at: string | null;
    webhook_subscribed_at: string | null;
  }>(
    `SELECT last_auto_sync_at, last_auto_sync_summary, last_campaign_sync_at, webhook_subscribed_at
     FROM crm_meta_settings WHERE id = 1 LIMIT 1`,
    { type: QueryTypes.SELECT },
  );

  const forms = await sequelize.query(
    `SELECT f.form_id, f.form_name, f.status, f.question_count, f.auto_mapped_count, f.last_synced_at,
            (SELECT COUNT(*) FROM crm_meta_leads ml WHERE ml.form_id = f.form_id) AS leads_count
     FROM crm_meta_forms f ORDER BY f.meta_created_time DESC, f.id DESC LIMIT 200`,
    { type: QueryTypes.SELECT },
  );

  const cfg = await getMetaSyncConfig();
  const tokenHealth = await inspectPageToken();

  let lastSummary: unknown = null;
  try { lastSummary = settings?.last_auto_sync_summary ? JSON.parse(settings.last_auto_sync_summary) : null; } catch { /* truncated */ }

  return NextResponse.json({
    config: { pageId: cfg.pageId, adAccountId: cfg.adAccountId, enabled: cfg.enabled },
    lastAutoSyncAt: settings?.last_auto_sync_at ?? null,
    lastCampaignSyncAt: settings?.last_campaign_sync_at ?? null,
    webhookSubscribedAt: settings?.webhook_subscribed_at ?? null,
    lastSummary,
    forms,
    tokenHealth,
  });
}

/** POST - run a full sync now. Body: { registerWebhook?: boolean } */
export async function POST(request: NextRequest) {
  const auth = requireAuth(request, ['admin.access', 'marketing.manage']);
  if (isAuthError(auth)) return auth;
  await ensureDB();

  const body = await request.json().catch(() => ({})) as { registerWebhook?: boolean };
  const registerWebhookUrl = body.registerWebhook
    ? `${(process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin).replace(/\/$/, '')}/api/webhooks/meta`
    : undefined;

  const summary = await runMetaAutoSync({ registerWebhookUrl });
  return NextResponse.json(summary);
}
