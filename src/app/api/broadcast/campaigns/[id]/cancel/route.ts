import { NextRequest, NextResponse } from 'next/server';
import { Op } from 'sequelize';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { connectDB, sequelize } from '@/lib/sequelize';
import { CrmBroadcastCampaigns, CrmBroadcastRecipients, CrmAutomationAuditLogs } from '@/models';
import { canAccessBranchScopedRecord } from '@/lib/roleChecks';

const CAMPAIGN_PERMISSION = ['campaigns.manage'];
const TERMINAL_CAMPAIGN_STATUSES = ['completed', 'cancelled', 'failed'];

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(request, CAMPAIGN_PERMISSION);
  if (isAuthError(auth)) return auth;
  try {
    await connectDB();
    const { id } = await params;
    const campaign = await CrmBroadcastCampaigns.findOne({ where: { id: Number.parseInt(id, 10), isDeleted: false } });
    if (!campaign) return NextResponse.json({ success: false, error: 'Campaign not found' }, { status: 404 });
    if (!canAccessBranchScopedRecord(auth, campaign)) return NextResponse.json({ success: false, error: 'Campaign not found' }, { status: 404 });
    if (TERMINAL_CAMPAIGN_STATUSES.includes(campaign.status)) {
      return NextResponse.json({ success: false, error: `Campaign is already in a terminal status ("${campaign.status}")` }, { status: 409 });
    }

    const body = await request.json().catch(() => ({}));

    // Marks every not-yet-sent recipient 'skipped_cancelled' immediately
    // (rather than only flipping the campaign's own status and relying on
    // the worker to notice) so cancellation takes effect the instant this
    // call completes, in the same transaction as the campaign's own status
    // flip - matching the spec's "cancellation propagation" and "allow
    // cancellation ... checks immediately before each external send" rules
    // (the worker also re-checks campaign status per-send as a second line
    // of defense against a send that was already in flight).
    await sequelize.transaction(async (transaction) => {
      await CrmBroadcastRecipients.update(
        { status: 'skipped_cancelled' },
        { where: { campaignId: campaign.id, status: { [Op.in]: ['pending', 'queued'] } }, transaction }
      );
      await campaign.update({ status: 'cancelled', cancelledAt: new Date(), cancelReason: body.reason ?? null }, { transaction });
      await CrmAutomationAuditLogs.create({
        actorId: auth.id, action: 'campaign.cancelled', branchId: campaign.branchId,
        objectType: 'broadcast_campaign', objectId: campaign.id, metadata: { reason: body.reason ?? null },
      }, { transaction });
    });

    return NextResponse.json({ success: true, campaign });
  } catch (error) {
    console.error('Failed to cancel broadcast campaign:', error);
    return NextResponse.json({ success: false, error: 'Failed to cancel broadcast campaign' }, { status: 500 });
  }
}
