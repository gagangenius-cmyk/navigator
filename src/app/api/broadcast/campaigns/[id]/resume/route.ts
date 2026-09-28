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
    if (campaign.status !== 'paused') {
      return NextResponse.json({ success: false, error: `Cannot resume a campaign in status "${campaign.status}"` }, { status: 409 });
    }

    // Still-future scheduled_at_utc resumes as 'scheduled' (the scheduler
    // tick will flip it to 'running' at the right time); otherwise straight
    // back to 'running' so the worker picks its remaining queued recipients
    // back up on its next tick.
    const isScheduledForLater = Boolean(campaign.scheduledAtUtc && campaign.scheduledAtUtc.getTime() > Date.now());
    await campaign.update({ status: isScheduledForLater ? 'scheduled' : 'running', pausedAt: null });
    await CrmAutomationAuditLogs.create({
      actorId: auth.id, action: 'campaign.resumed', branchId: campaign.branchId,
      objectType: 'broadcast_campaign', objectId: campaign.id, metadata: null,
    });

    return NextResponse.json({ success: true, campaign });
  } catch (error) {
    console.error('Failed to resume broadcast campaign:', error);
    return NextResponse.json({ success: false, error: 'Failed to resume broadcast campaign' }, { status: 500 });
  }
}
