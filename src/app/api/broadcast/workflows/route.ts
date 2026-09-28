import { NextRequest, NextResponse } from 'next/server';
import { Op } from 'sequelize';
import crypto from 'crypto';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { connectDB } from '@/lib/sequelize';
import { CrmWorkflowDefinitions, CrmWorkflowVersions } from '@/models';
import { canViewAllBranches } from '@/lib/roleChecks';
import { validateWorkflowGraph, type WorkflowGraph } from '@/lib/workflowGraphValidator';

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

export async function GET(request: NextRequest) {
  const auth = requireAuth(request, WORKFLOW_PERMISSION);
  if (isAuthError(auth)) return auth;
  try {
    await ensureDb();
    const { searchParams } = new URL(request.url);
    const workflowType = searchParams.get('workflowType');
    const status = searchParams.get('status');

    const scopeWhere = canViewAllBranches(auth) ? {} : { branchId: { [Op.or]: [auth.branch ?? -1, null] } };
    const where: Record<string | symbol, unknown> = { [Op.and]: [{ isDeleted: false }, scopeWhere] };
    if (workflowType) (where[Op.and] as unknown[]).push({ workflowType });
    if (status) (where[Op.and] as unknown[]).push({ status });

    const workflows = await CrmWorkflowDefinitions.findAll({ where, order: [['id', 'DESC']] });
    return NextResponse.json({ success: true, workflows });
  } catch (error) {
    console.error('Failed to list workflow definitions:', error);
    return NextResponse.json({ success: false, error: 'Failed to list workflow definitions' }, { status: 500 });
  }
}

// Creates a workflow definition and its first draft version (version_number
// 1) in one call, mirroring the template library's own create-with-first-
// version pattern (src/app/api/broadcast/templates/route.ts).
export async function POST(request: NextRequest) {
  const auth = requireAuth(request, WORKFLOW_PERMISSION);
  if (isAuthError(auth)) return auth;
  try {
    await ensureDb();
    const body = await request.json();

    if (!body.name || typeof body.name !== 'string') {
      return NextResponse.json({ success: false, error: 'name is required' }, { status: 400 });
    }
    const workflowType = body.workflowType === 'bot' ? 'bot' : 'automation';

    const graph = body.graph as WorkflowGraph | undefined;
    if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
      return NextResponse.json({ success: false, error: 'graph.nodes and graph.edges are required' }, { status: 400 });
    }
    const validation = validateWorkflowGraph(graph);
    if (!validation.valid) {
      return NextResponse.json({ success: false, error: 'Workflow graph failed validation', errors: validation.errors }, { status: 400 });
    }

    const workflow = await CrmWorkflowDefinitions.create({
      branchId: auth.branch ?? null,
      workflowType,
      name: body.name,
      description: body.description ?? null,
      status: 'draft',
      currentDraftVersionId: null,
      currentPublishedVersionId: null,
      ownerId: auth.id,
    });

    const version = await CrmWorkflowVersions.create({
      workflowId: workflow.id,
      versionNumber: 1,
      graphJson: graph,
      validationHash: graphHash(graph),
      createdBy: auth.id,
    });

    await workflow.update({ currentDraftVersionId: version.id });

    return NextResponse.json({ success: true, workflow, version }, { status: 201 });
  } catch (error) {
    console.error('Failed to create workflow definition:', error);
    return NextResponse.json({ success: false, error: 'Failed to create workflow definition' }, { status: 500 });
  }
}
