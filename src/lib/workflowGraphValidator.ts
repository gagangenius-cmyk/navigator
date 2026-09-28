import { getNodeTypeDef } from './workflowNodeRegistry';

// Structural validation for a workflow graph (crm_workflow_versions.graph_json)
// before it can be saved as a draft or published. Catches exactly what
// docs/broadcast-architecture.md / the originating spec calls for: cycles
// without a wait (runaway loops), missing required branches, disconnected
// nodes, incompatible handles, and unreachable nodes. Pure and DB-free by
// design - the same validation must run identically client-side (import
// this module into the eventual React Flow editor) and server-side (the
// Phase 4 publish API route), so there is exactly one implementation of
// "is this graph valid," never two that can drift apart.

export interface WorkflowGraphNode {
  id: string;
  type: string;
  data: unknown;
  /** Canvas layout only (React Flow) - never read by validation or the runtime engine. */
  position?: { x: number; y: number };
}

export interface WorkflowGraphEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
}

export interface WorkflowGraph {
  nodes: WorkflowGraphNode[];
  edges: WorkflowGraphEdge[];
}

export interface WorkflowGraphError {
  code:
    | 'unknown_node_type'
    | 'invalid_node_config'
    | 'no_trigger'
    | 'dangling_edge'
    | 'trigger_has_incoming'
    | 'disconnected_node'
    | 'terminal_node_has_outgoing'
    | 'missing_required_branch'
    | 'duplicate_branch'
    | 'invalid_handle'
    | 'missing_continuation'
    | 'ambiguous_continuation'
    | 'unreachable_node'
    | 'runaway_loop'
    | 'graph_too_large';
  nodeId?: string;
  edgeId?: string;
  message: string;
}

const MAX_NODES = 500;

export function validateWorkflowGraph(graph: WorkflowGraph): { valid: boolean; errors: WorkflowGraphError[] } {
  const errors: WorkflowGraphError[] = [];
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));

  if (graph.nodes.length > MAX_NODES) {
    errors.push({ code: 'graph_too_large', message: `Workflow has ${graph.nodes.length} nodes, exceeding the ${MAX_NODES} limit` });
  }

  // 1. Node types + config
  let hasTrigger = false;
  for (const node of graph.nodes) {
    const def = getNodeTypeDef(node.type);
    if (!def) {
      errors.push({ code: 'unknown_node_type', nodeId: node.id, message: `Node "${node.id}" has unknown type "${node.type}"` });
      continue;
    }
    if (def.category === 'trigger') hasTrigger = true;

    const parsed = def.configSchema.safeParse(node.data);
    if (!parsed.success) {
      errors.push({ code: 'invalid_node_config', nodeId: node.id, message: `Node "${node.id}" (${node.type}) has invalid config: ${parsed.error.message}` });
    }
  }
  if (!hasTrigger) {
    errors.push({ code: 'no_trigger', message: 'Workflow has no trigger node - it can never be enrolled into' });
  }

  // 2. Dangling edges
  const validEdges: WorkflowGraphEdge[] = [];
  for (const edge of graph.edges) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) {
      errors.push({ code: 'dangling_edge', edgeId: edge.id, message: `Edge "${edge.id}" references a node that does not exist` });
      continue;
    }
    validEdges.push(edge);
  }

  const outgoingByNode = new Map<string, WorkflowGraphEdge[]>();
  const incomingByNode = new Map<string, WorkflowGraphEdge[]>();
  for (const edge of validEdges) {
    if (!outgoingByNode.has(edge.source)) outgoingByNode.set(edge.source, []);
    outgoingByNode.get(edge.source)!.push(edge);
    if (!incomingByNode.has(edge.target)) incomingByNode.set(edge.target, []);
    incomingByNode.get(edge.target)!.push(edge);
  }

  // 3. Per-node incoming/outgoing shape
  for (const node of graph.nodes) {
    const def = getNodeTypeDef(node.type);
    if (!def) continue; // already reported above

    const incoming = incomingByNode.get(node.id) ?? [];
    const outgoing = outgoingByNode.get(node.id) ?? [];

    if (!def.allowsIncoming && incoming.length > 0) {
      errors.push({ code: 'trigger_has_incoming', nodeId: node.id, message: `Trigger node "${node.id}" cannot have an incoming edge` });
    }
    if (def.allowsIncoming && incoming.length === 0) {
      errors.push({ code: 'disconnected_node', nodeId: node.id, message: `Node "${node.id}" (${node.type}) has no incoming edge` });
    }

    if (def.isTerminal) {
      if (outgoing.length > 0) {
        errors.push({ code: 'terminal_node_has_outgoing', nodeId: node.id, message: `Terminal node "${node.id}" (${node.type}) cannot have an outgoing edge` });
      }
      continue;
    }

    if (node.type === 'branch') {
      const cases = ((node.data as { cases?: { value: string }[] })?.cases ?? []).map((c) => c.value);
      const allowedHandles = new Set([...cases, 'default']);
      const seenHandles = new Set<string>();
      for (const edge of outgoing) {
        const handle = edge.sourceHandle ?? '';
        if (!allowedHandles.has(handle)) {
          errors.push({ code: 'invalid_handle', nodeId: node.id, edgeId: edge.id, message: `Branch node "${node.id}" has an edge with handle "${handle}" that is not one of its declared cases` });
        }
        seenHandles.add(handle);
      }
      if (outgoing.length === 0) {
        errors.push({ code: 'missing_continuation', nodeId: node.id, message: `Branch node "${node.id}" has no outgoing edges` });
      }
      continue;
    }

    if (node.type === 'bot.quick_reply') {
      const options = ((node.data as { options?: { value: string }[] })?.options ?? []).map((o) => o.value);
      const allowedHandles = new Set([...options, 'timeout']);
      for (const edge of outgoing) {
        const handle = edge.sourceHandle ?? '';
        if (!allowedHandles.has(handle)) {
          errors.push({ code: 'invalid_handle', nodeId: node.id, edgeId: edge.id, message: `bot.quick_reply node "${node.id}" has an edge with handle "${handle}" that is not one of its declared options or "timeout"` });
        }
      }
      if (outgoing.length === 0) {
        errors.push({ code: 'missing_continuation', nodeId: node.id, message: `bot.quick_reply node "${node.id}" has no outgoing edges` });
      }
      continue;
    }

    if (def.outgoingHandles) {
      const seen = new Map<string, number>();
      for (const edge of outgoing) {
        const handle = edge.sourceHandle ?? '';
        if (!def.outgoingHandles.includes(handle)) {
          errors.push({ code: 'invalid_handle', nodeId: node.id, edgeId: edge.id, message: `Node "${node.id}" (${node.type}) has an edge with an unexpected handle "${handle}"` });
          continue;
        }
        seen.set(handle, (seen.get(handle) ?? 0) + 1);
      }
      for (const requiredHandle of def.outgoingHandles) {
        const count = seen.get(requiredHandle) ?? 0;
        if (count === 0) {
          errors.push({ code: 'missing_required_branch', nodeId: node.id, message: `Node "${node.id}" (${node.type}) is missing its required "${requiredHandle}" branch` });
        } else if (count > 1) {
          errors.push({ code: 'duplicate_branch', nodeId: node.id, message: `Node "${node.id}" (${node.type}) has more than one edge on its "${requiredHandle}" branch` });
        }
      }
      continue;
    }

    // Plain single-continuation node (most actions, waits other than wait.for_event).
    if (outgoing.length === 0) {
      errors.push({ code: 'missing_continuation', nodeId: node.id, message: `Node "${node.id}" (${node.type}) has no outgoing edge and is not a terminal node type` });
    } else if (outgoing.length > 1) {
      errors.push({ code: 'ambiguous_continuation', nodeId: node.id, message: `Node "${node.id}" (${node.type}) has more than one outgoing edge but only supports a single continuation` });
    }
  }

  // 4. Unreachable nodes - forward BFS from every trigger.
  const triggerIds = graph.nodes.filter((n) => getNodeTypeDef(n.type)?.category === 'trigger').map((n) => n.id);
  const reachable = new Set<string>(triggerIds);
  const queue = [...triggerIds];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of outgoingByNode.get(current) ?? []) {
      if (!reachable.has(edge.target)) {
        reachable.add(edge.target);
        queue.push(edge.target);
      }
    }
  }
  for (const node of graph.nodes) {
    if (!reachable.has(node.id)) {
      errors.push({ code: 'unreachable_node', nodeId: node.id, message: `Node "${node.id}" (${node.type}) is not reachable from any trigger` });
    }
  }

  // 5. Cycle detection - a cycle is only a "runaway loop" if none of its
  // nodes is a wait node (a loop that always passes through a wait is a
  // legitimate bounded-pacing pattern, e.g. a nurture sequence that
  // re-checks a condition every few days).
  const cycles = findCycles(graph.nodes.map((n) => n.id), validEdges);
  for (const cycle of cycles) {
    const hasWait = cycle.some((nodeId) => getNodeTypeDef(nodeById.get(nodeId)?.type ?? '')?.category === 'wait');
    if (!hasWait) {
      errors.push({ code: 'runaway_loop', message: `Cycle with no wait node found: ${cycle.join(' -> ')} - this would execute without ever pausing` });
    }
  }

  return { valid: errors.length === 0, errors };
}

// Standard DFS-based cycle detection (white/gray/black coloring), returning
// each distinct cycle as the ordered list of node ids that form it.
function findCycles(nodeIds: string[], edges: WorkflowGraphEdge[]): string[][] {
  const adjacency = new Map<string, string[]>();
  for (const id of nodeIds) adjacency.set(id, []);
  for (const edge of edges) adjacency.get(edge.source)?.push(edge.target);

  const color = new Map<string, 'white' | 'gray' | 'black'>(nodeIds.map((id) => [id, 'white']));
  const stack: string[] = [];
  const cycles: string[][] = [];

  function visit(nodeId: string) {
    color.set(nodeId, 'gray');
    stack.push(nodeId);

    for (const next of adjacency.get(nodeId) ?? []) {
      const state = color.get(next);
      if (state === 'gray') {
        const cycleStart = stack.indexOf(next);
        cycles.push([...stack.slice(cycleStart), next]);
      } else if (state === 'white') {
        visit(next);
      }
    }

    stack.pop();
    color.set(nodeId, 'black');
  }

  for (const id of nodeIds) {
    if (color.get(id) === 'white') visit(id);
  }

  return cycles;
}
