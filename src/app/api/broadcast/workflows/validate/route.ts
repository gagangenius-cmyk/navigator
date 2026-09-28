import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { validateWorkflowGraph, type WorkflowGraph } from '@/lib/workflowGraphValidator';

// Stateless validation - lets the (future) React Flow editor check a graph
// server-side (the authoritative validator - see
// src/lib/workflowGraphValidator.ts's header comment on why client and
// server must share exactly this one implementation) while the user is
// still editing, without creating a version row for every keystroke.
export async function POST(request: NextRequest) {
  const auth = requireAuth(request, ['workflows.manage']);
  if (isAuthError(auth)) return auth;
  try {
    const body = await request.json();
    const graph = body.graph as WorkflowGraph | undefined;
    if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
      return NextResponse.json({ success: false, error: 'graph.nodes and graph.edges are required' }, { status: 400 });
    }
    const result = validateWorkflowGraph(graph);
    return NextResponse.json({ success: true, valid: result.valid, errors: result.errors });
  } catch (error) {
    console.error('Failed to validate workflow graph:', error);
    return NextResponse.json({ success: false, error: 'Failed to validate workflow graph' }, { status: 500 });
  }
}
