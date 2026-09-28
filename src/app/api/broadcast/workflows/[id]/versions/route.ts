import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { connectDB } from '@/lib/sequelize';
import { CrmWorkflowDefinitions, CrmWorkflowVersions } from '@/models';
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

function graphHash(graph: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(graph), 'utf8').digest('hex');
}

// New draft version - never edits an existing version's graph_json in
// place, for the same reason templates don't (a published version may
// already have live enrollments referencing it - crm_workflow_enrollments.workflow_version_id
// is ON DELETE RESTRICT specifically to guarantee that).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(request, WORKFLOW_PERMISSION);
  if (isAuthError(auth)) return auth;
  try {
    await ensureDb();
    const { id } = await params;
    const workflow = await CrmWorkflowDefinitions.findOne({ where: { id: Number.parseInt(id, 10), isDeleted: false } });
    if (!workflow) return NextResponse.json({ success: false, error: 'Workflow not found' }, { status: 404 });
    if (!canAccessBranchScopedRecord(auth, workflow)) return NextResponse.json({ success: false, error: 'Workflow not found' }, { status: 404 });

    const body = await request.json();
    const graph = body.graph as WorkflowGraph | undefined;
    if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
      return NextResponse.json({ success: false, error: 'graph.nodes and graph.edges are required' }, { status: 400 });
    }
    const validation = validateWorkflowGraph(graph);
    if (!validation.valid) {
      return NextResponse.json({ success: false, error: 'Workflow graph failed validation', errors: validation.errors }, { status: 400 });
    }

    const latest = await CrmWorkflowVersions.findOne({ where: { workflowId: workflow.id }, order: [['versionNumber', 'DESC']] });
    const nextVersionNumber = (latest?.versionNumber ?? 0) + 1;

    const version = await CrmWorkflowVersions.create({
      workflowId: workflow.id,
      versionNumber: nextVersionNumber,
      graphJson: graph,
      validationHash: graphHash(graph),
      createdBy: auth.id,
    });

    await workflow.update({ currentDraftVersionId: version.id });

    return NextResponse.json({ success: true, version }, { status: 201 });
  } catch (error) {
    console.error('Failed to create workflow version:', error);
    return NextResponse.json({ success: false, error: 'Failed to create workflow version' }, { status: 500 });
  }
}
