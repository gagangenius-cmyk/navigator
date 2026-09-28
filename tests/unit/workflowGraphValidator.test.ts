import { describe, expect, it } from 'vitest';
import { validateWorkflowGraph, type WorkflowGraph } from '../../src/lib/workflowGraphValidator';

const trigger = (id: string) => ({ id, type: 'trigger.manual', data: {} });
const action = (id: string) => ({ id, type: 'action.create_note', data: { text: 'note' } });
const wait = (id: string) => ({ id, type: 'wait.duration', data: { amount: 1, unit: 'days' } });
const condition = (id: string) => ({ id, type: 'condition', data: { root: { type: 'and', conditions: [{ field: 'status', operator: 'eq', value: 'new' }] } } });
const end = (id: string) => ({ id, type: 'end', data: {} });

const edge = (id: string, source: string, target: string, sourceHandle?: string) => ({ id, source, target, sourceHandle });

function errorCodes(graph: WorkflowGraph) {
  return validateWorkflowGraph(graph).errors.map((e) => e.code);
}

describe('validateWorkflowGraph - happy paths', () => {
  it('accepts a minimal valid graph: trigger -> action -> end', () => {
    const graph: WorkflowGraph = {
      nodes: [trigger('t1'), action('a1'), end('e1')],
      edges: [edge('e-1', 't1', 'a1'), edge('e-2', 'a1', 'e1')],
    };
    const result = validateWorkflowGraph(graph);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('accepts a condition node with both true/false branches wired', () => {
    const graph: WorkflowGraph = {
      nodes: [trigger('t1'), condition('c1'), action('a1'), action('a2'), end('e1'), end('e2')],
      edges: [
        edge('e-1', 't1', 'c1'),
        edge('e-2', 'c1', 'a1', 'true'),
        edge('e-3', 'c1', 'a2', 'false'),
        edge('e-4', 'a1', 'e1'),
        edge('e-5', 'a2', 'e2'),
      ],
    };
    expect(validateWorkflowGraph(graph).valid).toBe(true);
  });

  it('accepts a loop that passes through a wait node (legitimate bounded pacing)', () => {
    const graph: WorkflowGraph = {
      nodes: [trigger('t1'), condition('c1'), wait('w1'), end('e1')],
      edges: [
        edge('e-1', 't1', 'c1'),
        edge('e-2', 'c1', 'e1', 'true'),
        edge('e-3', 'c1', 'w1', 'false'),
        edge('e-4', 'w1', 'c1'), // loops back, but through a wait
      ],
    };
    expect(validateWorkflowGraph(graph).valid).toBe(true);
  });
});

describe('validateWorkflowGraph - structural errors', () => {
  it('flags a workflow with no trigger node', () => {
    const graph: WorkflowGraph = { nodes: [action('a1'), end('e1')], edges: [edge('e-1', 'a1', 'e1')] };
    expect(errorCodes(graph)).toContain('no_trigger');
  });

  it('flags an unknown node type', () => {
    const graph: WorkflowGraph = { nodes: [trigger('t1'), { id: 'x1', type: 'not.a.real.type', data: {} }], edges: [edge('e-1', 't1', 'x1')] };
    expect(errorCodes(graph)).toContain('unknown_node_type');
  });

  it('flags invalid node config against its own schema', () => {
    const graph: WorkflowGraph = { nodes: [trigger('t1'), { id: 'w1', type: 'wait.duration', data: { amount: -5, unit: 'days' } }], edges: [edge('e-1', 't1', 'w1')] };
    expect(errorCodes(graph)).toContain('invalid_node_config');
  });

  it('flags a dangling edge referencing a nonexistent node', () => {
    const graph: WorkflowGraph = { nodes: [trigger('t1')], edges: [edge('e-1', 't1', 'ghost')] };
    expect(errorCodes(graph)).toContain('dangling_edge');
  });

  it('flags a trigger node with an incoming edge', () => {
    const graph: WorkflowGraph = { nodes: [trigger('t1'), trigger('t2')], edges: [edge('e-1', 't1', 't2')] };
    expect(errorCodes(graph)).toContain('trigger_has_incoming');
  });

  it('flags a disconnected (no incoming edge) non-trigger node', () => {
    const graph: WorkflowGraph = { nodes: [trigger('t1'), action('a1'), action('a2')], edges: [edge('e-1', 't1', 'a1')] };
    expect(errorCodes(graph)).toContain('disconnected_node');
    // a2 with zero edges at all is also unreachable
    expect(errorCodes(graph)).toContain('unreachable_node');
  });

  it('flags a terminal node with an outgoing edge', () => {
    const graph: WorkflowGraph = { nodes: [trigger('t1'), end('e1'), action('a1')], edges: [edge('e-1', 't1', 'e1'), edge('e-2', 'e1', 'a1')] };
    expect(errorCodes(graph)).toContain('terminal_node_has_outgoing');
  });

  it('flags a condition node missing its "false" branch', () => {
    const graph: WorkflowGraph = {
      nodes: [trigger('t1'), condition('c1'), action('a1')],
      edges: [edge('e-1', 't1', 'c1'), edge('e-2', 'c1', 'a1', 'true')],
    };
    expect(errorCodes(graph)).toContain('missing_required_branch');
  });

  it('flags a condition node with a duplicate branch on the same handle', () => {
    const graph: WorkflowGraph = {
      nodes: [trigger('t1'), condition('c1'), action('a1'), action('a2'), action('a3')],
      edges: [
        edge('e-1', 't1', 'c1'),
        edge('e-2', 'c1', 'a1', 'true'),
        edge('e-3', 'c1', 'a2', 'true'),
        edge('e-4', 'c1', 'a3', 'false'),
      ],
    };
    expect(errorCodes(graph)).toContain('duplicate_branch');
  });

  it('flags an edge with a handle not valid for that node type', () => {
    const graph: WorkflowGraph = {
      nodes: [trigger('t1'), condition('c1'), action('a1'), action('a2')],
      edges: [
        edge('e-1', 't1', 'c1'),
        edge('e-2', 'c1', 'a1', 'true'),
        edge('e-3', 'c1', 'a2', 'maybe'),
      ],
    };
    expect(errorCodes(graph)).toContain('invalid_handle');
  });

  it('flags a plain action node with zero outgoing edges', () => {
    const graph: WorkflowGraph = { nodes: [trigger('t1'), action('a1')], edges: [edge('e-1', 't1', 'a1')] };
    expect(errorCodes(graph)).toContain('missing_continuation');
  });

  it('flags a plain action node with more than one outgoing edge', () => {
    const graph: WorkflowGraph = {
      nodes: [trigger('t1'), action('a1'), end('e1'), end('e2')],
      edges: [edge('e-1', 't1', 'a1'), edge('e-2', 'a1', 'e1'), edge('e-3', 'a1', 'e2')],
    };
    expect(errorCodes(graph)).toContain('ambiguous_continuation');
  });

  it('flags an unreachable node even if it has valid incoming edges within its own isolated island', () => {
    const graph: WorkflowGraph = {
      nodes: [trigger('t1'), action('a1'), end('e1'), action('island1'), end('island2')],
      edges: [
        edge('e-1', 't1', 'a1'),
        edge('e-2', 'a1', 'e1'),
        edge('e-3', 'island1', 'island2'), // a valid little island, but not reachable from t1
      ],
    };
    expect(errorCodes(graph)).toContain('unreachable_node');
  });

  it('flags a tight cycle with no wait node as a runaway loop', () => {
    const graph: WorkflowGraph = {
      nodes: [trigger('t1'), condition('c1'), action('a1'), end('e1')],
      edges: [
        edge('e-1', 't1', 'c1'),
        edge('e-2', 'c1', 'a1', 'true'),
        edge('e-3', 'c1', 'e1', 'false'),
        edge('e-4', 'a1', 'c1'), // loops straight back with no wait in between
      ],
    };
    expect(errorCodes(graph)).toContain('runaway_loop');
  });

  it('flags a branch node edge with a handle not among its declared cases', () => {
    const graph: WorkflowGraph = {
      nodes: [trigger('t1'), { id: 'b1', type: 'branch', data: { field: 'status', cases: [{ value: 'new', label: 'New' }, { value: 'won', label: 'Won' }] } }, action('a1')],
      edges: [edge('e-1', 't1', 'b1'), edge('e-2', 'b1', 'a1', 'lost')],
    };
    expect(errorCodes(graph)).toContain('invalid_handle');
  });

  it('accepts a bot.quick_reply node whose edges match its declared option values plus "timeout"', () => {
    const graph: WorkflowGraph = {
      nodes: [
        trigger('t1'),
        { id: 'q1', type: 'bot.quick_reply', data: { text: 'Interested?', options: [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }] } },
        action('a1'), action('a2'), end('e1'), end('e2'), end('e3'),
      ],
      edges: [
        edge('e-1', 't1', 'q1'),
        edge('e-2', 'q1', 'a1', 'yes'),
        edge('e-3', 'q1', 'a2', 'no'),
        edge('e-4', 'q1', 'e3', 'timeout'),
        edge('e-5', 'a1', 'e1'),
        edge('e-6', 'a2', 'e2'),
      ],
    };
    expect(validateWorkflowGraph(graph).valid).toBe(true);
  });

  it('flags a bot.quick_reply edge with a handle not among its options or "timeout"', () => {
    const graph: WorkflowGraph = {
      nodes: [trigger('t1'), { id: 'q1', type: 'bot.quick_reply', data: { text: 'Interested?', options: [{ value: 'yes', label: 'Yes' }] } }, action('a1')],
      edges: [edge('e-1', 't1', 'q1'), edge('e-2', 'q1', 'a1', 'maybe')],
    };
    expect(errorCodes(graph)).toContain('invalid_handle');
  });
});
