import { describe, expect, it } from 'vitest';
import {
  checkTemplateApprovedForLaunch,
  computePublishedConfigHash,
  isRecipientEligible,
} from '../../src/lib/broadcastPreflight';

describe('checkTemplateApprovedForLaunch', () => {
  it('approves an email/SMS template once published and status=approved', () => {
    const result = checkTemplateApprovedForLaunch({
      channel: 'email',
      status: 'approved',
      providerTemplateId: null,
      currentPublishedVersionId: 5,
    });
    expect(result.approved).toBe(true);
  });

  it('rejects any template with no published version, regardless of status', () => {
    const result = checkTemplateApprovedForLaunch({
      channel: 'email',
      status: 'approved',
      providerTemplateId: null,
      currentPublishedVersionId: null,
    });
    expect(result).toEqual({ approved: false, reason: 'no_published_version' });
  });

  it('rejects a WhatsApp template that is only pending_review - the core compliance rule', () => {
    // This is the exact state POST .../publish leaves a WhatsApp template in
    // today (docs/broadcast-architecture.md: no real Meta submission
    // integration exists yet), so this case is the one that matters most.
    const result = checkTemplateApprovedForLaunch({
      channel: 'whatsapp',
      status: 'pending_review',
      providerTemplateId: null,
      currentPublishedVersionId: 5,
    });
    expect(result).toEqual({ approved: false, reason: 'not_approved' });
  });

  it('rejects a WhatsApp template marked approved but with no real Meta provider_template_id', () => {
    const result = checkTemplateApprovedForLaunch({
      channel: 'whatsapp',
      status: 'approved',
      providerTemplateId: null,
      currentPublishedVersionId: 5,
    });
    expect(result).toEqual({ approved: false, reason: 'whatsapp_missing_provider_id' });
  });

  it('approves a WhatsApp template only once both status=approved AND a provider id exist', () => {
    const result = checkTemplateApprovedForLaunch({
      channel: 'whatsapp',
      status: 'approved',
      providerTemplateId: 'meta-template-123',
      currentPublishedVersionId: 5,
    });
    expect(result.approved).toBe(true);
  });
});

describe('isRecipientEligible', () => {
  it('always excludes a suppressed address, regardless of purpose or consent', () => {
    expect(isRecipientEligible({ purpose: 'transactional', consentState: 'opted_in', isSuppressed: true }))
      .toEqual({ eligible: false, reason: 'suppressed' });
  });

  it('always excludes an explicit opt-out, regardless of purpose', () => {
    expect(isRecipientEligible({ purpose: 'transactional', consentState: 'opted_out', isSuppressed: false }))
      .toEqual({ eligible: false, reason: 'opted_out' });
  });

  it('requires explicit opt-in for a marketing send', () => {
    expect(isRecipientEligible({ purpose: 'marketing', consentState: 'unknown', isSuppressed: false }))
      .toEqual({ eligible: false, reason: 'no_consent' });
    expect(isRecipientEligible({ purpose: 'marketing', consentState: 'opted_in', isSuppressed: false }))
      .toEqual({ eligible: true });
  });

  it('allows a transactional send with unknown consent (no opt-out on file)', () => {
    expect(isRecipientEligible({ purpose: 'transactional', consentState: 'unknown', isSuppressed: false }))
      .toEqual({ eligible: true });
  });
});

describe('computePublishedConfigHash', () => {
  it('is deterministic for identical config', () => {
    const config = { templateVersionId: 1, segmentId: 2, variableMapping: { first_name: 'fname' }, scheduledAtUtc: null };
    expect(computePublishedConfigHash(config)).toBe(computePublishedConfigHash({ ...config }));
  });

  it('changes when any field changes', () => {
    const base = { templateVersionId: 1, segmentId: 2, variableMapping: {}, scheduledAtUtc: null };
    expect(computePublishedConfigHash(base)).not.toBe(computePublishedConfigHash({ ...base, segmentId: 3 }));
  });
});
