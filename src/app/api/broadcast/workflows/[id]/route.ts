import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { connectDB } from '@/lib/sequelize';
import { CrmWorkflowDefinitions, CrmWorkflowVersions } from '@/models';
import { canAccessBranchScopedRecord } from '@/lib/roleChecks';

const WORKFLOW_PERMISSION = ['workflows.manage'];

let dbReady = false;
const ensureDb = async () => {
  if (!dbReady) {
    await connectDB();
    dbReady = true;
  }
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(request, WORKFLOW_PERMISSION);
  if (isAuthError(auth)) return auth;
  try {
    await ensureDb();
    const { id } = await params;
    const workflow = await CrmWorkflowDefinitions.findOne({ where: { id: Number.parseInt(id, 10), isDeleted: false } });
    if (!workflow) return NextResponse.json({ success: false, error: 'Workflow not found' }, { status: 404 });
    if (!canAccessBranchScopedRecord(auth, workflow)) return NextResponse.json({ success: false, error: 'Workflow not found' }, { status: 404 });

    const versions = await CrmWorkflowVersions.findAll({ where: { workflowId: workflow.id }, order: [['versionNumber', 'DESC']] });
    return NextResponse.json({ success: true, workflow, versions });
  } catch (error) {
    console.error('Failed to fetch workflow definition:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch workflow definition' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(request, WORKFLOW_PERMISSION);
  if (isAuthError(auth)) return auth;
  try {
    await ensureDb();
    const { id } = await params;
    const workflow = await CrmWorkflowDefinitions.findOne({ where: { id: Number.parseInt(id, 10), isDeleted: false } });
    if (!workflow) return NextResponse.json({ success: false, error: 'Workflow not found' }, { status: 404 });
    if (!canAccessBranchScopedRecord(auth, workflow)) return NextResponse.json({ success: false, error: 'Workflow not found' }, { status: 404 });

    const body = await request.json();
    const updates: Partial<{ name: string; description: string | null }> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;

    await workflow.update(updates);
    return NextResponse.json({ success: true, workflow });
  } catch (error) {
    console.error('Failed to update workflow definition:', error);
    return NextResponse.json({ success: false, error: 'Failed to update workflow definition' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(request, WORKFLOW_PERMISSION);
  if (isAuthError(auth)) return auth;
  try {
    await ensureDb();
    const { id } = await params;
    const workflow = await CrmWorkflowDefinitions.findOne({ where: { id: Number.parseInt(id, 10), isDeleted: false } });
    if (!workflow) return NextResponse.json({ success: false, error: 'Workflow not found' }, { status: 404 });
    if (!canAccessBranchScopedRecord(auth, workflow)) return NextResponse.json({ success: false, error: 'Workflow not found' }, { status: 404 });

    // Soft delete - crm_workflow_enrollments.workflow_version_id is
    // ON DELETE RESTRICT, so a workflow version any enrollment has ever
    // referenced can never be hard-deleted anyway; archiving is the
    // meaningful "stop offering this" action, not physical deletion.
    await workflow.update({ isDeleted: true, deletedAt: new Date(), status: 'archived' });
    return NextResponse.json({ success: true, message: 'Workflow deleted successfully' });
  } catch (error) {
    console.error('Failed to delete workflow definition:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete workflow definition' }, { status: 500 });
  }
}
