import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { connectDB } from '@/lib/sequelize';
import { CrmBroadcastCampaigns, CrmBroadcastRecipients, CrmContactSegments, sequelize } from '@/models';
import { canAccessBranchScopedRecord, canAccessSegment } from '@/lib/roleChecks';

const CAMPAIGN_PERMISSION = ['campaigns.manage'];

let dbReady = false;
const ensureDb = async () => {
  if (!dbReady) {
    await connectDB();
    dbReady = true;
  }
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(request, CAMPAIGN_PERMISSION);
  if (isAuthError(auth)) return auth;
  try {
    await ensureDb();
    const { id } = await params;
    const campaign = await CrmBroadcastCampaigns.findOne({ where: { id: Number.parseInt(id, 10), isDeleted: false } });
    if (!campaign) return NextResponse.json({ success: false, error: 'Campaign not found' }, { status: 404 });
    if (!canAccessBranchScopedRecord(auth, campaign)) return NextResponse.json({ success: false, error: 'Campaign not found' }, { status: 404 });

    const statusCounts = await CrmBroadcastRecipients.findAll({
      where: { campaignId: campaign.id },
      attributes: ['status', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
      group: ['status'],
      raw: true,
    }) as unknown as { status: string; count: string }[];

    return NextResponse.json({
      success: true,
      campaign,
      recipientCounts: Object.fromEntries(statusCounts.map((row) => [row.status, Number(row.count)])),
    });
  } catch (error) {
    console.error('Failed to fetch broadcast campaign:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch broadcast campaign' }, { status: 500 });
  }
}

// Draft-only metadata edits - once launched, config is frozen
// (published_config_hash) and must not change; use pause/resume/cancel
// instead.
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(request, CAMPAIGN_PERMISSION);
  if (isAuthError(auth)) return auth;
  try {
    await ensureDb();
    const { id } = await params;
    const campaign = await CrmBroadcastCampaigns.findOne({ where: { id: Number.parseInt(id, 10), isDeleted: false } });
    if (!campaign) return NextResponse.json({ success: false, error: 'Campaign not found' }, { status: 404 });
    if (!canAccessBranchScopedRecord(auth, campaign)) return NextResponse.json({ success: false, error: 'Campaign not found' }, { status: 404 });
    if (campaign.status !== 'draft') {
      return NextResponse.json({ success: false, error: 'Only a draft campaign can be edited - it is immutable once launched' }, { status: 409 });
    }

    const body = await request.json();

    if (body.segmentId) {
      const segment = await CrmContactSegments.findOne({ where: { id: body.segmentId, isDeleted: false } });
      if (!segment) return NextResponse.json({ success: false, error: 'Segment not found' }, { status: 404 });
      if (!canAccessSegment(auth, segment)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const updates: Partial<{ name: string; segmentId: number | null; variableMapping: unknown; scheduledAtUtc: Date | null; scheduledTimezone: string | null }> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.segmentId !== undefined) updates.segmentId = body.segmentId;
    if (body.variableMapping !== undefined) updates.variableMapping = body.variableMapping;
    if (body.scheduledAtUtc !== undefined) updates.scheduledAtUtc = body.scheduledAtUtc ? new Date(body.scheduledAtUtc) : null;
    if (body.scheduledTimezone !== undefined) updates.scheduledTimezone = body.scheduledTimezone;

    await campaign.update(updates);
    return NextResponse.json({ success: true, campaign });
  } catch (error) {
    console.error('Failed to update broadcast campaign:', error);
    return NextResponse.json({ success: false, error: 'Failed to update broadcast campaign' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(request, CAMPAIGN_PERMISSION);
  if (isAuthError(auth)) return auth;
  try {
    await ensureDb();
    const { id } = await params;
    const campaign = await CrmBroadcastCampaigns.findOne({ where: { id: Number.parseInt(id, 10), isDeleted: false } });
    if (!campaign) return NextResponse.json({ success: false, error: 'Campaign not found' }, { status: 404 });
    if (!canAccessBranchScopedRecord(auth, campaign)) return NextResponse.json({ success: false, error: 'Campaign not found' }, { status: 404 });
    if (campaign.status !== 'draft') {
      return NextResponse.json({ success: false, error: 'Only a draft campaign can be deleted - cancel a launched one instead' }, { status: 409 });
    }

    await campaign.update({ isDeleted: true, deletedAt: new Date() });
    return NextResponse.json({ success: true, message: 'Campaign deleted successfully' });
  } catch (error) {
    console.error('Failed to delete broadcast campaign:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete broadcast campaign' }, { status: 500 });
  }
}
