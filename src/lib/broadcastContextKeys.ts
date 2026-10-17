// Pure (no DB) list of the per-recipient context variables, so the variable
// mapping schema and unit tests don't drag the database layer in.
export const CONTEXT_VARIABLE_KEYS = [
  'appointment_date',
  'appointment_time',
  'counselor_name',
  'counselor_phone',
  'counselor_email',
  'branch_name',
  'branch_address',
  'branch_phone',
  'balance_due',
  'due_date',
] as const;
export type ContextVariableKey = (typeof CONTEXT_VARIABLE_KEYS)[number];
