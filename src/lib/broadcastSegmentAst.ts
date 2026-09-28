import { z } from 'zod';
import { Op, type WhereOptions } from 'sequelize';

// Validated filter AST for crm_contact_segments.filter_ast
// (docs/broadcast-architecture.md). Never raw SQL from the client - every
// field name is checked against SEGMENT_FIELD_ALLOWLIST below before it can
// reach a query, and every operator maps to a fixed Sequelize Op, so there
// is no path from a segment definition to arbitrary SQL injection.

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

const OPERATORS_BY_TYPE: Record<string, string[]> = {
  string: ['eq', 'neq', 'contains', 'in', 'is_null', 'is_not_null'],
  number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'is_null', 'is_not_null'],
  date: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_null', 'is_not_null'],
};

const conditionSchema = z.object({
  field: z.enum(Object.keys(SEGMENT_FIELD_ALLOWLIST) as [SegmentField, ...SegmentField[]]),
  operator: z.enum(['eq', 'neq', 'contains', 'in', 'gt', 'gte', 'lt', 'lte', 'is_null', 'is_not_null']),
  value: z.union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))]).optional(),
}).refine((condition) => {
  const fieldType = SEGMENT_FIELD_ALLOWLIST[condition.field].type;
  return OPERATORS_BY_TYPE[fieldType].includes(condition.operator);
}, { message: 'Operator is not valid for this field\'s type' })
  .refine((condition) => condition.operator === 'is_null' || condition.operator === 'is_not_null' || condition.value !== undefined, {
    message: 'A value is required for every operator except is_null/is_not_null',
  });

// Recursive group node: { type: 'and' | 'or', conditions: (condition | group)[] }
export type SegmentGroupNode = {
  type: 'and' | 'or';
  conditions: (z.infer<typeof conditionSchema> | SegmentGroupNode)[];
};

const groupSchema: z.ZodType<SegmentGroupNode> = z.lazy(() =>
  z.object({
    type: z.enum(['and', 'or']),
    conditions: z.array(z.union([conditionSchema, groupSchema])).min(1).max(50),
  })
);

export const segmentFilterAstSchema = groupSchema;

const OP_MAP: Record<string, symbol> = {
  eq: Op.eq,
  neq: Op.ne,
  contains: Op.like,
  in: Op.in,
  gt: Op.gt,
  gte: Op.gte,
  lt: Op.lt,
  lte: Op.lte,
};

function isGroupNode(node: unknown): node is SegmentGroupNode {
  return typeof node === 'object' && node !== null && 'conditions' in node;
}

// Converts a validated AST into a Sequelize WhereOptions fragment. Assumes
// the AST already passed segmentFilterAstSchema.safeParse() - this function
// does not re-validate field/operator combinations, only builds the query.
export function segmentAstToSequelizeWhere(node: SegmentGroupNode): WhereOptions {
  const opSymbol = node.type === 'and' ? Op.and : Op.or;
  return {
    [opSymbol]: node.conditions.map((child) => {
      if (isGroupNode(child)) {
        return segmentAstToSequelizeWhere(child);
      }
      const { field, operator, value } = child;
      const column = SEGMENT_FIELD_ALLOWLIST[field].column;

      if (operator === 'is_null') return { [column]: { [Op.is]: null } };
      if (operator === 'is_not_null') return { [column]: { [Op.not]: null } };
      if (operator === 'contains') return { [column]: { [Op.like]: `%${value}%` } };
      return { [column]: { [OP_MAP[operator]]: value } };
    }),
  };
}
