// Pure metadata for the segment filter AST (crm_contact_segments.filter_ast) -
// no `sequelize` import, unlike src/lib/broadcastSegmentAst.ts, specifically
// so this file is safe to import from a 'use client' component (the segment
// builder UI) without pulling the Sequelize/mysql2 driver into the browser
// bundle. broadcastSegmentAst.ts imports its copy of this data from here
// rather than duplicating it, so the server-side query builder and the
// client-side builder UI can never drift out of sync on which fields/
// operators are actually allowed.

// Columns on crm_forum_leads (src/models/CrmcForumLeads.ts) that a segment
// may filter on, with the operators that make sense for their type. Kept
// deliberately small for Phase 3's first cut - extend this list (never
// bypass it) as real campaign use cases need more fields.
export const SEGMENT_FIELD_ALLOWLIST = {
  branch: { column: 'branch', type: 'number' },
  region: { column: 'region', type: 'number' },
  status: { column: 'status', type: 'string' },
  assignTo: { column: 'assignTo', type: 'number' },
  opportunity_status: { column: 'opportunity_status', type: 'string' },
  qualification_score: { column: 'qualification_score', type: 'number' },
  created: { column: 'created', type: 'date' },
  next_followup_date: { column: 'next_followup_date', type: 'date' },
} as const;

export type SegmentField = keyof typeof SEGMENT_FIELD_ALLOWLIST;

export type SegmentOperator = 'eq' | 'neq' | 'contains' | 'in' | 'gt' | 'gte' | 'lt' | 'lte' | 'is_null' | 'is_not_null';

export const SEGMENT_OPERATORS_BY_TYPE: Record<string, SegmentOperator[]> = {
  string: ['eq', 'neq', 'contains', 'in', 'is_null', 'is_not_null'],
  number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'is_null', 'is_not_null'],
  date: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_null', 'is_not_null'],
};

// Display-only - never used for query building (that stays column/operator
// symbols only, see broadcastSegmentAst.ts).
export const SEGMENT_FIELD_LABELS: Record<SegmentField, string> = {
  branch: 'Branch',
  region: 'Region',
  status: 'Lead status',
  assignTo: 'Assigned to',
  opportunity_status: 'Opportunity status',
  qualification_score: 'Qualification score',
  created: 'Created date',
  next_followup_date: 'Next follow-up date',
};

export const SEGMENT_OPERATOR_LABELS: Record<SegmentOperator, string> = {
  eq: 'is',
  neq: 'is not',
  contains: 'contains',
  in: 'is one of',
  gt: 'is after / greater than',
  gte: 'is on/after / at least',
  lt: 'is before / less than',
  lte: 'is on/before / at most',
  is_null: 'is empty',
  is_not_null: 'is not empty',
};

// 'in' takes a comma-separated list; is_null/is_not_null take no value at
// all. Every other operator takes exactly one value.
export function operatorTakesValue(operator: SegmentOperator): boolean {
  return operator !== 'is_null' && operator !== 'is_not_null';
}

export function operatorTakesMultipleValues(operator: SegmentOperator): boolean {
  return operator === 'in';
}
