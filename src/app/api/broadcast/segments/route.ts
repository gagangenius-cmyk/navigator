import { NextRequest, NextResponse } from 'next/server';
import { Op } from 'sequelize';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { connectDB } from '@/lib/sequelize';
import { CrmContactSegments, CrmcForumLeads } from '@/models';
import { canViewAllBranches } from '@/lib/roleChecks';
import { segmentFilterAstSchema, segmentAstToSequelizeWhere } from '@/lib/broadcastSegmentAst';

// Gated on 'campaigns.manage' (not a dedicated 'segments.manage') - that key
// already exists and is seeded to every role that should touch broadcast
// features (scripts/seed-roles-permissions.js). A finer-grained key can be
// split out later without a breaking change; see
// docs/broadcast-architecture.md open decision #4.
const SEGMENT_PERMISSION = ['campaigns.manage'];

let dbReady = false;
const ensureDb = async () => {
  if (!dbReady) {
    await connectDB();
    dbReady = true;
  }
};

export async function GET(request: NextRequest) {
  const auth = requireAuth(request, SEGMENT_PERMISSION);
  if (isAuthError(auth)) return auth;
  try {
    await ensureDb();

    // Mirrors src/lib/apiCrud.ts's listScope convention: full visibility for
    // CEO/DOS/etc, otherwise limited to the caller's own branch or segments
    // they personally own (a segment isn't necessarily branch-shared).
    const scopeWhere = canViewAllBranches(auth)
      ? {}
      : { [Op.or]: [{ branchId: auth.branch ?? -1 }, { ownerId: auth.id }] };

    const segments = await CrmContactSegments.findAll({
      where: { [Op.and]: [{ isDeleted: false }, scopeWhere] },
      order: [['id', 'DESC']],
    });

    return NextResponse.json({ success: true, segments });
  } catch (error) {
    console.error('Failed to list contact segments:', error);
    return NextResponse.json({ success: false, error: 'Failed to list contact segments' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = requireAuth(request, SEGMENT_PERMISSION);
  if (isAuthError(auth)) return auth;
  try {
    await ensureDb();
    const body = await request.json();

    if (!body.name || typeof body.name !== 'string') {
      return NextResponse.json({ success: false, error: 'name is required' }, { status: 400 });
    }

    const astResult = segmentFilterAstSchema.safeParse(body.filterAst);
    if (!astResult.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid filterAst', details: astResult.error.flatten() },
        { status: 400 }
      );
    }

    // Estimated count computed at create time so the UI can show it
    // immediately - re-estimated on demand via POST /estimate before a
    // campaign launch, since lead data changes after this segment is saved.
    const where = segmentAstToSequelizeWhere(astResult.data);
    const estimatedCount = await CrmcForumLeads.count({ where });

    const segment = await CrmContactSegments.create({
      branchId: auth.branch ?? null,
      name: body.name,
      description: body.description ?? null,
      filterAst: astResult.data,
      ownerId: auth.id,
      isShared: Boolean(body.isShared),
      lastEstimatedCount: estimatedCount,
      lastEstimatedAt: new Date(),
    });

    return NextResponse.json({ success: true, segment }, { status: 201 });
  } catch (error) {
    console.error('Failed to create contact segment:', error);
    return NextResponse.json({ success: false, error: 'Failed to create contact segment' }, { status: 500 });
  }
}
