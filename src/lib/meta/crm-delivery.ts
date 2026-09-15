import type { CrmPayload, DeliveryResult } from './types';
import { ingestWebToLead } from '@/lib/webToLeadsIngest';

/** Exponential backoff delay in seconds for each retry attempt (0-indexed) */
const RETRY_DELAYS_SECONDS = [
  5 * 60,       // Retry 1: 5 min
  15 * 60,      // Retry 2: 15 min
  60 * 60,      // Retry 3: 1 hour
  6 * 60 * 60,  // Retry 4: 6 hours
  24 * 60 * 60, // Retry 5: 24 hours
];

export const MAX_RETRY_COUNT = RETRY_DELAYS_SECONDS.length;

/** Returns the next retry datetime ISO string, or null if max retries exceeded */
export function nextRetryAt(retryCount: number): string | null {
  const delay = RETRY_DELAYS_SECONDS[retryCount];
  if (delay === undefined) return null;
  return new Date(Date.now() + delay * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Creates the lead directly in this CRM's own database — this app *is* the
 * CRM the leads are destined for (confirmed: cmgone.org/api/web-to-leads is
 * this same codebase), so there's no reason to round-trip the payload out
 * over HTTP to its own public URL. That hop only added a network failure
 * mode (DNS/TLS/outbound firewall) with no benefit.
 *
 * Still returns the same DeliveryResult shape processor.ts already expects
 * (success/status/body/error), so the delivery-tracking, retry-scheduling,
 * and admin logs/stats built around crm_meta_lead_deliveries need no changes.
 * Never throws — errors are captured.
 */
export async function deliverToCrm(payload: CrmPayload): Promise<DeliveryResult> {
  try {
    const result = await ingestWebToLead(payload as unknown as Record<string, unknown>);
    return {
      success: result.success,
      status: result.status,
      body: JSON.stringify(result).slice(0, 2000),
      error: result.success ? null : (result.error || `Ingest failed with status ${result.status}`),
    };
  } catch (err) {
    return {
      success: false,
      status: null,
      body: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Sends a test CRM delivery using a sample payload.
 * Only called from the admin test endpoint — never in production lead flow.
 */
export async function testCrmDelivery(): Promise<DeliveryResult> {
  const samplePayload: CrmPayload = {
    lastName: 'Test Lead - Meta Integration',
    email: 'test-meta@example.com',
    phone: '+971500000000',
    AgeRange: '25-34',
    ImmigrationType: 'Student Visa',
    Branch: 'Test',
    ResidentCountry: 'UAE',
    UTMSource: 'Facebook Lead Ads',
    Education: 'Bachelor',
    DestinationCountry: 'Canada',
    LeadSource: 'Facebook Lead Ads',
    roundrobin: 'true',
  };
  return deliverToCrm(samplePayload);
}
