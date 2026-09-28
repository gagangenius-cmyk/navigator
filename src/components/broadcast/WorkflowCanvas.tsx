'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  addEdge,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Button } from '@/components/ui/button';
import { WORKFLOW_NODE_TYPES, type WorkflowNodeCategory } from '@/lib/workflowNodeRegistry';
import type { WorkflowGraph, WorkflowGraphError } from '@/lib/workflowGraphValidator';

// The canvas editor for crm_workflow_versions.graph_json. Node
// type/handle/category metadata all comes from
// src/lib/workflowNodeRegistry.ts (safe to import client-side - it's pure
// Zod schemas, no server-only code), the same registry the server-side
// validator (src/lib/workflowGraphValidator.ts) checks a saved graph
// against - so what this canvas allows you to connect and what the server
// accepts as valid are governed by the same one source of truth.
//
// The node config editor below is a JSON textarea, not a bespoke form per
// node type. Building 20 individual typed forms (one per
// WORKFLOW_NODE_TYPES entry) is real additional UI work beyond this pass -
// this is an honest, functional v1: every node type is placeable,
// connectable, configurable (via JSON, validated against that type's own
// Zod schema on save) and the graph round-trips through the same
// validateWorkflowGraph() the publish API uses.

type RFNodeData = { workflowNodeType: string; config: Record<string, unknown>; label: string };

const CATEGORY_COLOR: Record<WorkflowNodeCategory, string> = {
  trigger: '#2563eb',
  condition: '#9333ea',
  wait: '#d97706',
  action: '#059669',
  control: '#6b7280',
};

function WorkflowNodeRenderer({ data, selected }: NodeProps) {
  const nodeData = data as unknown as RFNodeData;
  const def = WORKFLOW_NODE_TYPES[nodeData.workflowNodeType];
  const color = def ? CATEGORY_COLOR[def.category] : '#6b7280';
  const handles = def?.outgoingHandles;

  return (
    <div
      style={{ borderColor: color }}
      className={`min-w-[180px] rounded-lg border-2 bg-white px-3 py-2 shadow-sm ${selected ? 'ring-2 ring-offset-1' : ''}`}
    >
      {def?.allowsIncoming && <Handle type="target" position={Position.Left} />}
      <div className="text-xs font-semibold uppercase tracking-wide" style={{ color }}>
        {def?.category ?? 'unknown'}
      </div>
      <div className="text-sm font-medium text-[var(--cmg-ink)]">{nodeData.label}</div>

      {!def?.isTerminal && (
        handles ? (
          <div className="mt-1 flex flex-col gap-2">
            {handles.map((handle, index) => (
              <div key={handle} className="relative text-right text-[10px] text-[var(--cmg-muted)]">
                {handle}
                <Handle type="source" position={Position.Right} id={handle} style={{ top: 'auto', bottom: undefined, position: 'absolute', right: -14, transform: `translateY(${index * 0}px)` }} />
              </div>
            ))}
          </div>
        ) : (
          <Handle type="source" position={Position.Right} />
        )
      )}
    </div>
  );
}

const nodeTypes = { workflowNode: WorkflowNodeRenderer };

let idCounter = 0;
function nextId(prefix: string) {
  idCounter += 1;
  return `${prefix}-${Date.now()}-${idCounter}`;
}

function graphToReactFlow(graph: WorkflowGraph | null): { nodes: Node[]; edges: Edge[] } {
  if (!graph) return { nodes: [], edges: [] };
  return {
    nodes: graph.nodes.map((n, index) => ({
      id: n.id,
      type: 'workflowNode',
      position: n.position ?? { x: 120 + (index % 4) * 220, y: 80 + Math.floor(index / 4) * 140 },
      data: { workflowNodeType: n.type, config: (n.data as Record<string, unknown>) ?? {}, label: n.type },
    })),
    edges: graph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? undefined, label: e.sourceHandle ?? undefined })),
  };
}

function reactFlowToGraph(nodes: Node[], edges: Edge[]): WorkflowGraph {
  return {
    nodes: nodes.map((n) => {
      const data = n.data as unknown as RFNodeData;
      return { id: n.id, type: data.workflowNodeType, data: data.config, position: n.position };
    }),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? null })),
  };
}

interface WorkflowCanvasProps {
  initialGraph: WorkflowGraph | null;
  onSave: (graph: WorkflowGraph) => Promise<void>;
  saving?: boolean;
  validationErrors?: WorkflowGraphError[];
  onValidate: (graph: WorkflowGraph) => Promise<void>;
}

function WorkflowCanvasInner({ initialGraph, onSave, saving, validationErrors, onValidate }: WorkflowCanvasProps) {
  const initial = useMemo(() => graphToReactFlow(initialGraph), [initialGraph]);
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [configDraft, setConfigDraft] = useState('');
  const [configError, setConfigError] = useState<string | null>(null);

  const onConnect = useCallback((connection: Connection) => {
    setEdges((eds) => addEdge({ ...connection, label: connection.sourceHandle ?? undefined }, eds));
  }, [setEdges]);

  const addNode = (type: string) => {
    const id = nextId(type.replace(/\./g, '-'));
    setNodes((nds) => [...nds, {
      id,
      type: 'workflowNode',
      position: { x: 100 + nds.length * 30, y: 100 + nds.length * 20 },
      data: { workflowNodeType: type, config: {}, label: type },
    }]);
  };

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);

  const openInspector = (nodeId: string) => {
    setSelectedNodeId(nodeId);
    const node = nodes.find((n) => n.id === nodeId);
    setConfigDraft(JSON.stringify((node?.data as unknown as RFNodeData)?.config ?? {}, null, 2));
    setConfigError(null);
  };

  const applyConfig = () => {
    if (!selectedNodeId) return;
    try {
      const parsed = JSON.parse(configDraft);
      const def = WORKFLOW_NODE_TYPES[(selectedNode?.data as unknown as RFNodeData)?.workflowNodeType ?? ''];
      if (def) {
        const result = def.configSchema.safeParse(parsed);
        if (!result.success) {
          setConfigError(result.error.issues.map((i) => i.message).join('; '));
          return;
        }
      }
      setNodes((nds) => nds.map((n) => (n.id === selectedNodeId ? { ...n, data: { ...n.data, config: parsed } } : n)));
      setConfigError(null);
    } catch {
      setConfigError('Invalid JSON');
    }
  };

  const grouped = useMemo(() => {
    const byCategory: Record<WorkflowNodeCategory, string[]> = { trigger: [], condition: [], wait: [], action: [], control: [] };
    for (const def of Object.values(WORKFLOW_NODE_TYPES)) byCategory[def.category].push(def.type);
    return byCategory;
  }, []);

  return (
    <div className="flex h-[70vh] gap-3">
      <div className="w-56 shrink-0 overflow-y-auto rounded-lg border border-[var(--cmg-border)] bg-white p-3">
        <h3 className="mb-2 text-sm font-semibold">Node palette</h3>
        {(Object.keys(grouped) as WorkflowNodeCategory[]).map((category) => (
          <div key={category} className="mb-3">
            <div className="mb-1 text-xs font-medium uppercase text-[var(--cmg-muted)]" style={{ color: CATEGORY_COLOR[category] }}>{category}</div>
            {grouped[category].map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => addNode(type)}
                className="mb-1 block w-full rounded border border-[var(--cmg-border)] px-2 py-1 text-left text-xs hover:bg-[var(--cmg-blue-soft)]"
              >
                {type}
              </button>
            ))}
          </div>
        ))}
      </div>

      <div className="relative flex-1 rounded-lg border border-[var(--cmg-border)]">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          onNodeClick={(_, node) => openInspector(node.id)}
          fitView
        >
          <Background />
          <Controls />
          <MiniMap />
        </ReactFlow>
        <div className="absolute right-2 top-2 flex gap-2">
          <Button size="sm" variant="outline" onClick={() => onValidate(reactFlowToGraph(nodes, edges))}>Validate</Button>
          <Button size="sm" disabled={saving} onClick={() => onSave(reactFlowToGraph(nodes, edges))}>
            {saving ? 'Saving…' : 'Save draft'}
          </Button>
        </div>
        {validationErrors && validationErrors.length > 0 && (
          <div className="absolute bottom-2 left-2 right-2 max-h-32 overflow-y-auto rounded-md bg-red-50 p-2 text-xs text-[var(--cmg-red)]">
            {validationErrors.map((err, i) => (
              <div key={i}>[{err.code}] {err.message}</div>
            ))}
          </div>
        )}
      </div>

      <div className="w-72 shrink-0 overflow-y-auto rounded-lg border border-[var(--cmg-border)] bg-white p-3">
        <h3 className="mb-2 text-sm font-semibold">Inspector</h3>
        {!selectedNode && <p className="text-xs text-[var(--cmg-muted)]">Select a node to edit its configuration.</p>}
        {selectedNode && (
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium">{(selectedNode.data as unknown as RFNodeData).workflowNodeType}</p>
            <textarea
              className="min-h-[240px] w-full rounded-md border border-[var(--cmg-border)] p-2 font-mono text-xs"
              value={configDraft}
              onChange={(e) => setConfigDraft(e.target.value)}
            />
            {configError && <p className="text-xs text-[var(--cmg-red)]">{configError}</p>}
            <Button size="sm" onClick={applyConfig}>Apply config</Button>
          </div>
        )}
      </div>
    </div>
  );
}

export function WorkflowCanvas(props: WorkflowCanvasProps) {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
