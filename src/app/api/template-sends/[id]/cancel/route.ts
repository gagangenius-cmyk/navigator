import { NextRequest, NextResponse } from 'next/server';
import { QueryTypes } from 'sequelize';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { connectDB, sequelize } from '@/lib/sequelize';
import { loadTemplateSend } from '@/lib/templateSend/jobs';
import { canSendAsOwner } from '@/lib/templateSend/recipients';
import { logSendEvent } from '@/lib/templateSend/events';

let dbReady = false;
const ensureDb = async () => { if (!dbReady) { await connectDB(); dbReady = true; } };

/** POST /api/template-sends/:id/cancel - stops everything not yet sent. Already-sent emails stay sent. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(request, ['templates.use']);
  if (isAuthError(auth)) return auth;
  try {
    await ensureDb();
    const { id } = await params;
    const sendId = Number(id);
    const job = await loadTemplateSend(sendId, auth, canSendAsOwner(auth));
    if (!job) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    if (!['queued', 'scheduled', 'sending'].includes(String(job.status))) {
      return NextResponse.json({ success: false, error: `A ${job.status} send cannot be cancelled` }, { status: 409 });
    }
    await sequelize.query(
      "UPDATE crm_template_sends SET status = 'cancelled', completed_at = NOW() WHERE id = :id AND status IN ('queued','scheduled','sending')",
      { replacements: { id: sendId }, type: QueryTypes.UPDATE },
    );
    await sequelize.query(
      "UPDATE crm_template_send_items SET status = 'skipped', skip_reason = 'cancelled', lock_token = NULL WHERE send_id = :id AND status IN ('queued')",
      { replacements: { id: sendId }, type: QueryTypes.UPDATE },
    );
    await logSendEvent(sendId, 'cancelled', null, { actorId: auth.id });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to cancel template send:', error);
    return NextResponse.json({ success: false, error: 'Failed to cancel' }, { status: 500 });
  }
}
