import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { connectDB } from '@/lib/sequelize';
import { CrmcForumLeads } from '@/models';
import { segmentFilterAstSchema, segmentAstToSequelizeWhere } from '@/lib/broadcastSegmentAst';

// Stateless preview: validates a filterAst and returns the matching lead
// count without creating/updating a crm_contact_segments row. Used by the
// segment builder UI while the user is still editing (POST rather than GET
// since the AST can be large and is more natural as a request body).
export async function POST(request: NextRequest) {
  const auth = requireAuth(request, ['campaigns.manage']);
  if (isAuthError(auth)) return auth;
  try {
    await connectDB();
    const body = await request.json();

    const astResult = segmentFilterAstSchema.safeParse(body.filterAst);
    if (!astResult.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid filterAst', details: astResult.error.flatten() },
        { status: 400 }
      );
    }

    const count = await CrmcForumLeads.count({ where: segmentAstToSequelizeWhere(astResult.data) });
    return NextResponse.json({ success: true, estimatedCount: count });
  } catch (error) {
    console.error('Failed to estimate segment count:', error);
    return NextResponse.json({ success: false, error: 'Failed to estimate segment count' }, { status: 500 });
  }
}
