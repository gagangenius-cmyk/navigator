import { describe, expect, it } from 'vitest';
import { evaluateConditionGroup, type ConditionGroup } from '../../src/lib/workflowConditionEvaluator';

describe('evaluateConditionGroup', () => {
  it('evaluates a single eq condition', () => {
    const group: ConditionGroup = { type: 'and', conditions: [{ field: 'status', operator: 'eq', value: 'new' }] };
    expect(evaluateConditionGroup(group, { status: 'new' })).toBe(true);
    expect(evaluateConditionGroup(group, { status: 'contacted' })).toBe(false);
  });

  it('AND requires every condition to pass', () => {
    const group: ConditionGroup = {
      type: 'and',
      conditions: [
        { field: 'status', operator: 'eq', value: 'new' },
        { field: 'qualification_score', operator: 'gte', value: 50 },
      ],
    };
    expect(evaluateConditionGroup(group, { status: 'new', qualification_score: 70 })).toBe(true);
    expect(evaluateConditionGroup(group, { status: 'new', qualification_score: 30 })).toBe(false);
  });

  it('OR requires only one condition to pass', () => {
    const group: ConditionGroup = {
      type: 'or',
      conditions: [
        { field: 'status', operator: 'eq', value: 'won' },
        { field: 'status', operator: 'eq', value: 'negotiation' },
      ],
    };
    expect(evaluateConditionGroup(group, { status: 'negotiation' })).toBe(true);
    expect(evaluateConditionGroup(group, { status: 'lost' })).toBe(false);
  });

  it('recurses into a nested group (AND containing an OR)', () => {
    const group: ConditionGroup = {
      type: 'and',
      conditions: [
        { field: 'branch', operator: 'eq', value: 3 },
        { type: 'or', conditions: [
          { field: 'status', operator: 'eq', value: 'new' },
          { field: 'status', operator: 'eq', value: 'contacted' },
        ] },
      ],
    };
    expect(evaluateConditionGroup(group, { branch: 3, status: 'contacted' })).toBe(true);
    expect(evaluateConditionGroup(group, { branch: 3, status: 'won' })).toBe(false);
    expect(evaluateConditionGroup(group, { branch: 4, status: 'new' })).toBe(false);
  });

  it('is_null / is_not_null check presence, ignoring value', () => {
    expect(evaluateConditionGroup({ type: 'and', conditions: [{ field: 'next_followup_date', operator: 'is_null' }] }, {})).toBe(true);
    expect(evaluateConditionGroup({ type: 'and', conditions: [{ field: 'next_followup_date', operator: 'is_null' }] }, { next_followup_date: '2026-01-01' })).toBe(false);
    expect(evaluateConditionGroup({ type: 'and', conditions: [{ field: 'next_followup_date', operator: 'is_not_null' }] }, { next_followup_date: '2026-01-01' })).toBe(true);
  });

  it('contains checks a substring match on a string field', () => {
    const group: ConditionGroup = { type: 'and', conditions: [{ field: 'email', operator: 'contains', value: '@gmail.com' }] };
    expect(evaluateConditionGroup(group, { email: 'aisha@gmail.com' })).toBe(true);
    expect(evaluateConditionGroup(group, { email: 'aisha@yahoo.com' })).toBe(false);
  });

  it('in checks membership in a value list', () => {
    const group: ConditionGroup = { type: 'and', conditions: [{ field: 'region', operator: 'in', value: [1, 2, 3] }] };
    expect(evaluateConditionGroup(group, { region: 2 })).toBe(true);
    expect(evaluateConditionGroup(group, { region: 9 })).toBe(false);
  });

  it('numeric comparisons fail closed (false) when the context value is not a number', () => {
    const group: ConditionGroup = { type: 'and', conditions: [{ field: 'qualification_score', operator: 'gt', value: 10 }] };
    expect(evaluateConditionGroup(group, { qualification_score: 'not-a-number' as unknown as number })).toBe(false);
    expect(evaluateConditionGroup(group, {})).toBe(false);
  });

  it('missing field values fail closed for eq rather than throwing', () => {
    const group: ConditionGroup = { type: 'and', conditions: [{ field: 'missing_field', operator: 'eq', value: 'x' }] };
    expect(() => evaluateConditionGroup(group, {})).not.toThrow();
    expect(evaluateConditionGroup(group, {})).toBe(false);
  });
});
