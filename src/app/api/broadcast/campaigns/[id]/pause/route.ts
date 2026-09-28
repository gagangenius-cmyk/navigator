import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { connectDB } from '@/lib/sequelize';
import { CrmBroadcastCampaigns, CrmAutomationAuditLogs } from '@/models';
import { canAccessBranchScopedRecord } from '@/lib/roleChecks';

const CAMPAIGN_PERMISSION = ['campaigns.manage'];

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(request, CAMPAIGN_PERMISSION);
  if (isAuthError(auth)) return auth;
  try {
    await connectDB();
    const { id } = await params;
    const campaign = await CrmBroadcastCampaigns.findOne({ where: { id: Number.parseInt(id, 10), isDeleted: false } });
    if (!campaign) return NextResponse.json({ success: false, error: 'Campaign not found' }, { status: 404 });
    if (!canAccessBranchScopedRecord(auth, campaign)) return NextResponse.json({ success: false, error: 'Campaign not found' }, { status: 404 });
    if (!['running', 'scheduled'].includes(campaign.status)) {
      return NextResponse.json({ success: false, error: `Cannot pause a campaign in status "${campaign.status}"` }, { status: 409 });
    }

    // Pausing only flips the campaign's own status - queued recipient rows
    // are left as-is. The worker (src/lib/broadcastWorker.ts) re-checks the
    // campaign's status immediately before every send, so no in-flight
    // recipient is sent after this point; it simply stops being picked up
    // until resumed.
    await campaign.update({ status: 'paused', pausedAt: new Date() });
    await CrmAutomationAuditLogs.create({
      actorId: auth.id, action: 'campaign.paused', branchId: campaign.branchId,
      objectType: 'broadcast_campaign', objectId: campaign.id, metadata: null,
    });

    return NextResponse.json({ success: true, campaign });
  } catch (error) {
    console.error('Failed to pause broadcast campaign:', error);
    return NextResponse.json({ success: false, error: 'Failed to pause broadcast campaign' }, { status: 500 });
  }
}
