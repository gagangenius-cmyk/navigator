import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { connectDB } from '@/lib/sequelize';
import { CrmWorkflowDefinitions, CrmWorkflowVersions, CrmAutomationAuditLogs } from '@/models';
import { validateWorkflowGraph, type WorkflowGraph } from '@/lib/workflowGraphValidator';
import { canAccessBranchScopedRecord } from '@/lib/roleChecks';

const WORKFLOW_PERMISSION = ['workflows.manage'];

let dbReady = false;
const ensureDb = async () => {
  if (!dbReady) {
    await connectDB();
    dbReady = true;
  }
};

// Publishing only ever changes which version NEW enrollments will start on
// (crm_workflow_definitions.current_published_version_id) - an enrollment
// already in progress references its own workflow_version_id directly
// (crm_workflow_enrollments), so it is structurally unaffected by this
// call. That is the spec's "maintain stable behavior for running
// enrollments when a new draft is published" guarantee, enforced by the
// schema itself rather than by any check this route needs to make.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  const auth = requireAuth(request, WORKFLOW_PERMISSION);
  if (isAuthError(auth)) return auth;
  try {
    await ensureDb();
    const { id, versionId } = await params;
    const workflowId = Number.parseInt(id, 10);

    const workflow = await CrmWorkflowDefinitions.findOne({ where: { id: workflowId, isDeleted: false } });
    if (!workflow) return NextResponse.json({ success: false, error: 'Workflow not found' }, { status: 404 });
    if (!canAccessBranchScopedRecord(auth, workflow)) return NextResponse.json({ success: false, error: 'Workflow not found' }, { status: 404 });

    const version = await CrmWorkflowVersions.findOne({ where: { id: Number.parseInt(versionId, 10), workflowId } });
    if (!version) return NextResponse.json({ success: false, error: 'Version not found' }, { status: 404 });
    if (version.isPublished) {
      return NextResponse.json({ success: false, error: 'This version is already published' }, { status: 409 });
    }

    // Re-validate at publish time, not just at draft-save time - the node
    // registry itself cannot change between saves, but this is cheap
    // insurance against any future code path that writes a version without
    // going through the POST .../versions route above.
    const validation = validateWorkflowGraph(version.graphJson as unknown as WorkflowGraph);
    if (!validation.valid) {
      return NextResponse.json({ success: false, error: 'Workflow graph failed validation', errors: validation.errors }, { status: 400 });
    }

    await version.update({ isPublished: true, publishedAt: new Date() });
    await workflow.update({ currentPublishedVersionId: version.id, status: 'published' });

    await CrmAutomationAuditLogs.create({
      actorId: auth.id,
      action: 'workflow.published',
      branchId: workflow.branchId,
      objectType: 'workflow_definition',
      objectId: workflow.id,
      metadata: { versionId: version.id, versionNumber: version.versionNumber },
    });

    return NextResponse.json({ success: true, workflow, version });
  } catch (error) {
    console.error('Failed to publish workflow version:', error);
    return NextResponse.json({ success: false, error: 'Failed to publish workflow version' }, { status: 500 });
  }
}
