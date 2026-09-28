// Evaluates a workflow `condition` node's config (the same AND/OR condition
// tree shape defined in src/lib/workflowNodeRegistry.ts's conditionSchema)
// against an in-memory context object - never against the database
// directly, unlike src/lib/broadcastSegmentAst.ts's SQL-building sibling.
// The runtime engine (not yet built - see docs/broadcast-architecture.md
// Phase 4 progress) will call this once per enrollment with that
// enrollment's current lead snapshot as `context`, to decide which of a
// condition node's true/false edges to advance down.
//
// Deliberately NOT `eval`/`new Function` based - every operator below is a
// fixed comparison this file itself implements, so a condition node's
// config can never execute arbitrary code, matching the same rule the node
// registry's own header comment states.

export type ConditionOperator = 'eq' | 'neq' | 'contains' | 'in' | 'gt' | 'gte' | 'lt' | 'lte' | 'is_null' | 'is_not_null';

export interface ConditionLeaf {
  field: string;
  operator: ConditionOperator;
  value?: string | number | (string | number)[];
}

export interface ConditionGroup {
  type: 'and' | 'or';
  conditions: (ConditionLeaf | ConditionGroup)[];
}

export type ConditionContext = Record<string, string | number | boolean | null | undefined>;

function isGroup(node: ConditionLeaf | ConditionGroup): node is ConditionGroup {
  return 'conditions' in node;
}

function evaluateLeaf(leaf: ConditionLeaf, context: ConditionContext): boolean {
  const actual = context[leaf.field];

  switch (leaf.operator) {
    case 'is_null':
      return actual === null || actual === undefined;
    case 'is_not_null':
      return actual !== null && actual !== undefined;
    case 'eq':
      return actual === leaf.value;
    case 'neq':
      return actual !== leaf.value;
    case 'contains':
      return typeof actual === 'string' && typeof leaf.value !== 'undefined' && actual.includes(String(leaf.value));
    case 'in':
      return Array.isArray(leaf.value) && actual !== null && actual !== undefined && leaf.value.includes(actual as string | number);
    case 'gt':
      return typeof actual === 'number' && typeof leaf.value === 'number' && actual > leaf.value;
    case 'gte':
      return typeof actual === 'number' && typeof leaf.value === 'number' && actual >= leaf.value;
    case 'lt':
      return typeof actual === 'number' && typeof leaf.value === 'number' && actual < leaf.value;
    case 'lte':
      return typeof actual === 'number' && typeof leaf.value === 'number' && actual <= leaf.value;
    default:
      // Unreachable given ConditionOperator's exhaustive union, but fails
      // closed (false) rather than throwing if the config schema is ever
      // widened without updating this function.
      return false;
  }
}

export function evaluateConditionGroup(group: ConditionGroup, context: ConditionContext): boolean {
  const results = group.conditions.map((node) => (isGroup(node) ? evaluateConditionGroup(node, context) : evaluateLeaf(node, context)));
  return group.type === 'and' ? results.every(Boolean) : results.some(Boolean);
}
