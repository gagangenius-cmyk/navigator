import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { connectDB } from '@/lib/sequelize';
import { CrmWorkflowDefinitions, CrmWorkflowVersions, CrmAutomationAuditLogs } from '@/models';
import { canAccessBranchScopedRecord } from '@/lib/roleChecks';

const WORKFLOW_PERMISSION = ['workflows.manage'];

// Moves current_published_version_id back to an earlier already-published
// version. Does NOT un-publish the version being rolled back away from
// (published versions are immutable/permanent history, never deleted) and
// does not touch any enrollment already running on any version - same
// "enrollments pin their own workflow_version_id" guarantee as publish
// (see that route's header comment).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(request, WORKFLOW_PERMISSION);
  if (isAuthError(auth)) return auth;
  try {
    await connectDB();
    const { id } = await params;
    const workflowId = Number.parseInt(id, 10);
    const workflow = await CrmWorkflowDefinitions.findOne({ where: { id: workflowId, isDeleted: false } });
    if (!workflow) return NextResponse.json({ success: false, error: 'Workflow not found' }, { status: 404 });
    if (!canAccessBranchScopedRecord(auth, workflow)) return NextResponse.json({ success: false, error: 'Workflow not found' }, { status: 404 });

    const body = await request.json();
    const toVersionId = Number.parseInt(body.toVersionId, 10);
    if (!toVersionId) return NextResponse.json({ success: false, error: 'toVersionId is required' }, { status: 400 });

    const targetVersion = await CrmWorkflowVersions.findOne({ where: { id: toVersionId, workflowId, isPublished: true } });
    if (!targetVersion) {
      return NextResponse.json({ success: false, error: 'Target version was not found or was never published' }, { status: 404 });
    }

    await workflow.update({ currentPublishedVersionId: targetVersion.id, status: 'published' });
    await CrmAutomationAuditLogs.create({
      actorId: auth.id,
      action: 'workflow.rolled_back',
      branchId: workflow.branchId,
      objectType: 'workflow_definition',
      objectId: workflow.id,
      metadata: { toVersionId: targetVersion.id, toVersionNumber: targetVersion.versionNumber },
    });

    return NextResponse.json({ success: true, workflow });
  } catch (error) {
    console.error('Failed to roll back workflow:', error);
    return NextResponse.json({ success: false, error: 'Failed to roll back workflow' }, { status: 500 });
  }
}
