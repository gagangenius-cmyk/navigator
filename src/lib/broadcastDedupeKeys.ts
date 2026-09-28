import crypto from 'crypto';

// Deterministic hash builders shared by every dedup/idempotency column added
// in migrations/20261001_broadcast_automation_schema.sql (recipient
// idempotency_key, step-execution idempotency_key, suppression
// address_hash, wait event_correlation_key, enrollment
// enrollment_policy_key). Centralized here so a sender/worker and a report/
// admin screen can never compute the same logical key two different ways.
//
// All keys are sha256 hex (64 chars), matching the CHAR(64) columns they
// populate.

function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

// Trim + lowercase only. Real E.164 phone normalization belongs to the
// Phase 3 provider adapters (which already need it to call the WhatsApp/SMS
// APIs) - this function must stay a pure function of its string input so a
// suppression check and a suppression insert always agree, regardless of
// what normalization happens upstream.
function normalizeAddress(address: string): string {
  return address.trim().toLowerCase();
}

export function suppressionAddressHash(address: string): string {
  return sha256Hex(normalizeAddress(address));
}

export function recipientIdempotencyKey(campaignId: number, leadId: number | null, channel: string): string {
  return sha256Hex(`recipient:${campaignId}:${leadId ?? 'null'}:${channel}`);
}

export function stepExecutionIdempotencyKey(enrollmentId: number, nodeId: string, attempt: number): string {
  return sha256Hex(`step:${enrollmentId}:${nodeId}:${attempt}`);
}

export function waitEventCorrelationKey(enrollmentId: number, expectedEventType: string): string {
  return sha256Hex(`wait:${enrollmentId}:${expectedEventType}`);
}

export function enrollmentPolicyKey(workflowId: number, leadId: number, triggerEventId: string): string {
  return sha256Hex(`enrollment:${workflowId}:${leadId}:${triggerEventId}`);
}

export function outboxDedupeKey(aggregateType: string, aggregateId: number, eventType: string): string {
  return sha256Hex(`outbox:${aggregateType}:${aggregateId}:${eventType}`);
}

export function botMessageDedupKey(sessionId: number, providerMessageIdOrNodeId: string, attempt?: number): string {
  return attempt === undefined
    ? sha256Hex(`bot-inbound:${sessionId}:${providerMessageIdOrNodeId}`)
    : sha256Hex(`bot-outbound:${sessionId}:${providerMessageIdOrNodeId}:${attempt}`);
}
