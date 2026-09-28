import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { connectDB } from '@/lib/sequelize';
import { CrmContactSegments, CrmcForumLeads } from '@/models';
import { canAccessSegment as canAccess } from '@/lib/roleChecks';
import { segmentFilterAstSchema, segmentAstToSequelizeWhere } from '@/lib/broadcastSegmentAst';

const SEGMENT_PERMISSION = ['campaigns.manage'];

let dbReady = false;
const ensureDb = async () => {
  if (!dbReady) {
    await connectDB();
    dbReady = true;
  }
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(request, SEGMENT_PERMISSION);
  if (isAuthError(auth)) return auth;
  try {
    await ensureDb();
    const { id } = await params;
    const segment = await CrmContactSegments.findOne({ where: { id: Number.parseInt(id, 10), isDeleted: false } });
    if (!segment) return NextResponse.json({ success: false, error: 'Segment not found' }, { status: 404 });
    if (!canAccess(auth, segment)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    return NextResponse.json({ success: true, segment });
  } catch (error) {
    console.error('Failed to fetch contact segment:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch contact segment' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(request, SEGMENT_PERMISSION);
  if (isAuthError(auth)) return auth;
  try {
    await ensureDb();
    const { id } = await params;
    const segment = await CrmContactSegments.findOne({ where: { id: Number.parseInt(id, 10), isDeleted: false } });
    if (!segment) return NextResponse.json({ success: false, error: 'Segment not found' }, { status: 404 });
    if (!canAccess(auth, segment)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

    const body = await request.json();
    const updates: Partial<{ name: string; description: string | null; isShared: boolean; filterAst: Record<string, unknown>; lastEstimatedCount: number; lastEstimatedAt: Date }> = {};

    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.isShared !== undefined) updates.isShared = Boolean(body.isShared);

    if (body.filterAst !== undefined) {
      const astResult = segmentFilterAstSchema.safeParse(body.filterAst);
      if (!astResult.success) {
        return NextResponse.json(
          { success: false, error: 'Invalid filterAst', details: astResult.error.flatten() },
          { status: 400 }
        );
      }
      updates.filterAst = astResult.data;
      updates.lastEstimatedCount = await CrmcForumLeads.count({ where: segmentAstToSequelizeWhere(astResult.data) });
      updates.lastEstimatedAt = new Date();
    }

    await segment.update(updates);
    return NextResponse.json({ success: true, segment });
  } catch (error) {
    console.error('Failed to update contact segment:', error);
    return NextResponse.json({ success: false, error: 'Failed to update contact segment' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(request, SEGMENT_PERMISSION);
  if (isAuthError(auth)) return auth;
  try {
    await ensureDb();
    const { id } = await params;
    const segment = await CrmContactSegments.findOne({ where: { id: Number.parseInt(id, 10), isDeleted: false } });
    if (!segment) return NextResponse.json({ success: false, error: 'Segment not found' }, { status: 404 });
    if (!canAccess(auth, segment)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

    // Soft delete only - a launched campaign snapshots its segment's filter
    // AST at launch time (crm_broadcast_campaigns.segment_snapshot), so a
    // deleted segment never invalidates campaign history.
    await segment.update({ isDeleted: true, deletedAt: new Date() });
    return NextResponse.json({ success: true, message: 'Segment deleted successfully' });
  } catch (error) {
    console.error('Failed to delete contact segment:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete contact segment' }, { status: 500 });
  }
}
