import { NextRequest, NextResponse } from 'next/server';
import { Op } from 'sequelize';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { connectDB } from '@/lib/sequelize';
import { CrmBroadcastCampaigns, CrmMessageTemplateVersions, CrmMessageTemplates, CrmContactSegments } from '@/models';
import { canViewAllBranches, canAccessSegment } from '@/lib/roleChecks';
import { variableMappingSchema } from '@/lib/broadcastVariableMapping';

const CAMPAIGN_PERMISSION = ['campaigns.manage'];

let dbReady = false;
const ensureDb = async () => {
  if (!dbReady) {
    await connectDB();
    dbReady = true;
  }
};

export async function GET(request: NextRequest) {
  const auth = requireAuth(request, CAMPAIGN_PERMISSION);
  if (isAuthError(auth)) return auth;
  try {
    await ensureDb();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const channel = searchParams.get('channel');

    const scopeWhere = canViewAllBranches(auth) ? {} : { branchId: { [Op.or]: [auth.branch ?? -1, null] } };
    const where: Record<string | symbol, unknown> = { [Op.and]: [{ isDeleted: false }, scopeWhere] };
    if (status) (where[Op.and] as unknown[]).push({ status });
    if (channel) (where[Op.and] as unknown[]).push({ channel });

    const campaigns = await CrmBroadcastCampaigns.findAll({ where, order: [['id', 'DESC']] });
    return NextResponse.json({ success: true, campaigns });
  } catch (error) {
    console.error('Failed to list broadcast campaigns:', error);
    return NextResponse.json({ success: false, error: 'Failed to list broadcast campaigns' }, { status: 500 });
  }
}

// Creates a draft only - launching (snapshotting recipients, running the
// preflight, moving state out of 'draft') is a separate, deliberate step:
// POST /api/broadcast/campaigns/[id]/launch.
export async function POST(request: NextRequest) {
  const auth = requireAuth(request, CAMPAIGN_PERMISSION);
  if (isAuthError(auth)) return auth;
  try {
    await ensureDb();
    const body = await request.json();

    if (!body.name || typeof body.name !== 'string') {
      return NextResponse.json({ success: false, error: 'name is required' }, { status: 400 });
    }
    if (!body.templateVersionId) {
      return NextResponse.json({ success: false, error: 'templateVersionId is required' }, { status: 400 });
    }

    const version = await CrmMessageTemplateVersions.findByPk(body.templateVersionId);
    if (!version) return NextResponse.json({ success: false, error: 'Template version not found' }, { status: 404 });
    const template = await CrmMessageTemplates.findByPk(version.templateId);
    if (!template) return NextResponse.json({ success: false, error: 'Parent template not found' }, { status: 404 });

    let variableMapping: unknown = null;
    if (body.variableMapping !== undefined) {
      const mappingResult = variableMappingSchema.safeParse(body.variableMapping);
      if (!mappingResult.success) {
        return NextResponse.json(
          { success: false, error: 'Invalid variableMapping', details: mappingResult.error.flatten() },
          { status: 400 }
        );
      }
      variableMapping = mappingResult.data;
    }

    if (body.segmentId) {
      const segment = await CrmContactSegments.findOne({ where: { id: body.segmentId, isDeleted: false } });
      if (!segment) return NextResponse.json({ success: false, error: 'Segment not found' }, { status: 404 });
      if (!canAccessSegment(auth, segment)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const campaign = await CrmBroadcastCampaigns.create({
      branchId: auth.branch ?? null,
      channel: template.channel,
      name: body.name,
      templateVersionId: version.id,
      segmentId: body.segmentId ?? null,
      variableMapping,
      scheduledAtUtc: body.scheduledAtUtc ? new Date(body.scheduledAtUtc) : null,
      scheduledTimezone: body.scheduledTimezone ?? null,
      status: 'draft',
      createdBy: auth.id,
    });

    return NextResponse.json({ success: true, campaign }, { status: 201 });
  } catch (error) {
    console.error('Failed to create broadcast campaign:', error);
    return NextResponse.json({ success: false, error: 'Failed to create broadcast campaign' }, { status: 500 });
  }
}
