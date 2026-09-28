import { z } from 'zod';
import { Op, type WhereOptions } from 'sequelize';
import { SEGMENT_FIELD_ALLOWLIST, SEGMENT_OPERATORS_BY_TYPE as OPERATORS_BY_TYPE, type SegmentField } from './broadcastSegmentFields';

// Validated filter AST for crm_contact_segments.filter_ast
// (docs/broadcast-architecture.md). Never raw SQL from the client - every
// field name is checked against SEGMENT_FIELD_ALLOWLIST (src/lib/broadcastSegmentFields.ts)
// below before it can reach a query, and every operator maps to a fixed
// Sequelize Op, so there is no path from a segment definition to arbitrary
// SQL injection.

export { SEGMENT_FIELD_ALLOWLIST, type SegmentField };

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
