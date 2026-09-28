import { describe, expect, it } from 'vitest';
import { Op } from 'sequelize';
import { segmentAstToSequelizeWhere, segmentFilterAstSchema } from '../../src/lib/broadcastSegmentAst';

describe('segmentFilterAstSchema', () => {
  it('accepts a simple single-condition group', () => {
    const result = segmentFilterAstSchema.safeParse({
      type: 'and',
      conditions: [{ field: 'branch', operator: 'eq', value: 3 }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts nested groups (AND of ORs)', () => {
    const result = segmentFilterAstSchema.safeParse({
      type: 'and',
      conditions: [
        { field: 'branch', operator: 'eq', value: 3 },
        { type: 'or', conditions: [
          { field: 'status', operator: 'eq', value: 'new' },
          { field: 'status', operator: 'eq', value: 'contacted' },
        ] },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects a field not on the allowlist', () => {
    const result = segmentFilterAstSchema.safeParse({
      type: 'and',
      conditions: [{ field: 'password_hash', operator: 'eq', value: 'x' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an operator that does not fit the field\'s type (e.g. "contains" on a number field)', () => {
    const result = segmentFilterAstSchema.safeParse({
      type: 'and',
      conditions: [{ field: 'qualification_score', operator: 'contains', value: '5' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a value-bearing operator with no value', () => {
    const result = segmentFilterAstSchema.safeParse({
      type: 'and',
      conditions: [{ field: 'branch', operator: 'eq' }],
    });
    expect(result.success).toBe(false);
  });

  it('allows is_null with no value', () => {
    const result = segmentFilterAstSchema.safeParse({
      type: 'and',
      conditions: [{ field: 'next_followup_date', operator: 'is_null' }],
    });
    expect(result.success).toBe(true);
  });
});

describe('segmentAstToSequelizeWhere', () => {
  it('builds an Op.and/Op.or tree with the real column name and mapped operator', () => {
    const where = segmentAstToSequelizeWhere({
      type: 'and',
      conditions: [{ field: 'branch', operator: 'eq', value: 3 }],
    }) as Record<symbol, unknown[]>;

    const andClauses = where[Op.and] as Array<Record<string, unknown>>;
    expect(andClauses[0]).toEqual({ branch: { [Op.eq]: 3 } });
  });

  it('translates "contains" to a wrapped Op.like pattern', () => {
    const where = segmentAstToSequelizeWhere({
      type: 'and',
      conditions: [{ field: 'status', operator: 'contains', value: 'new' }],
    }) as Record<symbol, Array<Record<string, unknown>>>;

    expect(where[Op.and][0]).toEqual({ status: { [Op.like]: '%new%' } });
  });

  it('recurses into a nested group, producing an Op.or inside the outer Op.and', () => {
    const where = segmentAstToSequelizeWhere({
      type: 'and',
      conditions: [
        { field: 'branch', operator: 'eq', value: 3 },
        { type: 'or', conditions: [
          { field: 'status', operator: 'eq', value: 'new' },
          { field: 'status', operator: 'eq', value: 'contacted' },
        ] },
      ],
    }) as Record<symbol, unknown[]>;

    const nested = where[Op.and][1] as Record<symbol, unknown[]>;
    expect(nested[Op.or]).toHaveLength(2);
  });

  it('maps is_null/is_not_null without requiring a value', () => {
    const whereNull = segmentAstToSequelizeWhere({
      type: 'and',
      conditions: [{ field: 'next_followup_date', operator: 'is_null' }],
    }) as Record<symbol, Array<Record<string, unknown>>>;
    expect(whereNull[Op.and][0]).toEqual({ next_followup_date: { [Op.is]: null } });
  });
});
