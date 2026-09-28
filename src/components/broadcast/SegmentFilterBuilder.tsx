'use client';

import { Fragment } from 'react';
import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select-simple';
import {
  SEGMENT_FIELD_ALLOWLIST,
  SEGMENT_FIELD_LABELS,
  SEGMENT_OPERATORS_BY_TYPE,
  SEGMENT_OPERATOR_LABELS,
  operatorTakesValue,
  operatorTakesMultipleValues,
  type SegmentField,
  type SegmentOperator,
} from '@/lib/broadcastSegmentFields';

// Visual builder for crm_contact_segments.filter_ast
// (docs/broadcast-architecture.md, "visual segment builder" gap) - a form
// over the exact same recursive AND/OR AST src/lib/broadcastSegmentAst.ts
// validates and turns into a Sequelize WHERE clause server-side. This
// component only ever produces field/operator/value combinations that
// SEGMENT_FIELD_ALLOWLIST/SEGMENT_OPERATORS_BY_TYPE (src/lib/broadcastSegmentFields.ts,
// the same source of truth the server validates against) allow, but the
// server-side segmentFilterAstSchema.safeParse() remains the actual
// authority - this UI is a convenience, not a trust boundary.

export interface SegmentCondition {
  field: SegmentField;
  operator: SegmentOperator;
  value?: string | number | (string | number)[];
}

export interface SegmentGroup {
  type: 'and' | 'or';
  conditions: (SegmentCondition | SegmentGroup)[];
}

export type SegmentOption = { value: string; label: string };

// Only fields where a small, known set of valid values exists get a
// dropdown (fetched from existing endpoints - no new backend work). The
// rest (qualification_score, created, next_followup_date, and any
// field with no matching list) fall back to a plain number/date/text
// input - still fully valid, just less guided.
export interface SegmentFieldOptionLists {
  branch?: SegmentOption[];
  region?: SegmentOption[];
  status?: SegmentOption[];
  assignTo?: SegmentOption[];
}

function isGroup(node: SegmentCondition | SegmentGroup): node is SegmentGroup {
  return 'conditions' in node;
}

function defaultCondition(): SegmentCondition {
  const field: SegmentField = 'status';
  const operator = SEGMENT_OPERATORS_BY_TYPE[SEGMENT_FIELD_ALLOWLIST[field].type][0];
  return { field, operator, value: operatorTakesValue(operator) ? '' : undefined };
}

export function emptySegmentGroup(): SegmentGroup {
  return { type: 'and', conditions: [defaultCondition()] };
}

const FIELD_ORDER = Object.keys(SEGMENT_FIELD_ALLOWLIST) as SegmentField[];

function ConditionRow({
  condition, options, onChange, onRemove,
}: {
  condition: SegmentCondition;
  options: SegmentFieldOptionLists;
  onChange: (next: SegmentCondition) => void;
  onRemove: () => void;
}) {
  const fieldType = SEGMENT_FIELD_ALLOWLIST[condition.field].type;
  const availableOperators = SEGMENT_OPERATORS_BY_TYPE[fieldType];
  const fieldOptions = options[condition.field as keyof SegmentFieldOptionLists];
  const needsValue = operatorTakesValue(condition.operator);
  const multi = operatorTakesMultipleValues(condition.operator);
  const currentValueText = Array.isArray(condition.value) ? condition.value.join(', ') : String(condition.value ?? '');

  function handleFieldChange(nextField: SegmentField) {
    const nextType = SEGMENT_FIELD_ALLOWLIST[nextField].type;
    const nextOperators = SEGMENT_OPERATORS_BY_TYPE[nextType];
    const nextOperator = nextOperators.includes(condition.operator) ? condition.operator : nextOperators[0];
    onChange({ field: nextField, operator: nextOperator, value: operatorTakesValue(nextOperator) ? '' : undefined });
  }

  function handleOperatorChange(nextOperator: SegmentOperator) {
    onChange({ ...condition, operator: nextOperator, value: operatorTakesValue(nextOperator) ? (condition.value ?? '') : undefined });
  }

  function handleValueChange(raw: string) {
    if (multi) {
      onChange({ ...condition, value: raw.split(',').map((v) => v.trim()).filter(Boolean) });
      return;
    }
    if (fieldType === 'number') {
      onChange({ ...condition, value: raw === '' ? '' : Number(raw) });
      return;
    }
    onChange({ ...condition, value: raw });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--cmg-border)] bg-white p-2">
      <Select value={condition.field} onValueChange={(v) => handleFieldChange(v as SegmentField)} className="w-44">
        <SelectTrigger><span>{SEGMENT_FIELD_LABELS[condition.field]}</span></SelectTrigger>
        <SelectContent>
          {FIELD_ORDER.map((f) => <SelectItem key={f} value={f}>{SEGMENT_FIELD_LABELS[f]}</SelectItem>)}
        </SelectContent>
      </Select>

      <Select value={condition.operator} onValueChange={(v) => handleOperatorChange(v as SegmentOperator)} className="w-52">
        <SelectTrigger><span>{SEGMENT_OPERATOR_LABELS[condition.operator]}</span></SelectTrigger>
        <SelectContent>
          {availableOperators.map((op) => <SelectItem key={op} value={op}>{SEGMENT_OPERATOR_LABELS[op]}</SelectItem>)}
        </SelectContent>
      </Select>

      {needsValue && fieldOptions && !multi ? (
        <Select value={currentValueText} onValueChange={handleValueChange} className="w-48">
          <SelectTrigger>
            <span>{fieldOptions.find((o) => o.value === currentValueText)?.label || 'Choose a value'}</span>
          </SelectTrigger>
          <SelectContent>
            {fieldOptions.map((opt) => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
          </SelectContent>
        </Select>
      ) : needsValue ? (
        <Input
          className="w-48"
          type={fieldType === 'date' ? 'date' : fieldType === 'number' && !multi ? 'number' : 'text'}
          value={currentValueText}
          onChange={(e) => handleValueChange(e.target.value)}
          placeholder={multi ? 'value1, value2, …' : undefined}
        />
      ) : null}

      <Button type="button" variant="ghost" size="sm" onClick={onRemove} aria-label="Remove condition">
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}

export function SegmentFilterGroupEditor({
  group, options, onChange, onRemove, depth = 0,
}: {
  group: SegmentGroup;
  options: SegmentFieldOptionLists;
  onChange: (next: SegmentGroup) => void;
  onRemove?: () => void;
  depth?: number;
}) {
  function updateChild(index: number, next: SegmentCondition | SegmentGroup) {
    const conditions = group.conditions.slice();
    conditions[index] = next;
    onChange({ ...group, conditions });
  }

  function removeChild(index: number) {
    const conditions = group.conditions.filter((_, i) => i !== index);
    onChange({ ...group, conditions: conditions.length > 0 ? conditions : [defaultCondition()] });
  }

  function addCondition() {
    onChange({ ...group, conditions: [...group.conditions, defaultCondition()] });
  }

  function addGroup() {
    onChange({ ...group, conditions: [...group.conditions, { type: 'and', conditions: [defaultCondition()] }] });
  }

  return (
    <div className={`flex flex-col gap-2 rounded-md ${depth > 0 ? 'border border-dashed border-[var(--cmg-border)] bg-gray-50 p-3' : ''}`}>
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-[var(--cmg-muted)]">Match</span>
        <Select value={group.type} onValueChange={(v) => onChange({ ...group, type: v as 'and' | 'or' })} className="w-24">
          <SelectTrigger><span>{group.type === 'and' ? 'all' : 'any'}</span></SelectTrigger>
          <SelectContent>
            <SelectItem value="and">all</SelectItem>
            <SelectItem value="or">any</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-xs font-medium text-[var(--cmg-muted)]">of the following:</span>
        {onRemove && (
          <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={onRemove} aria-label="Remove group">
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {group.conditions.map((child, index) => (
        <Fragment key={index}>
          {isGroup(child) ? (
            <SegmentFilterGroupEditor
              group={child}
              options={options}
              onChange={(next) => updateChild(index, next)}
              onRemove={() => removeChild(index)}
              depth={depth + 1}
            />
          ) : (
            <ConditionRow
              condition={child}
              options={options}
              onChange={(next) => updateChild(index, next)}
              onRemove={() => removeChild(index)}
            />
          )}
        </Fragment>
      ))}

      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={addCondition}>
          <Plus className="mr-1 h-3 w-3" /> Condition
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={addGroup}>
          <Plus className="mr-1 h-3 w-3" /> Group
        </Button>
      </div>
    </div>
  );
}
