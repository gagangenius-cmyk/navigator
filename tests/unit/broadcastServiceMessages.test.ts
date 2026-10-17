import { describe, expect, it } from 'vitest';
import { purposeForCategory, TEMPLATE_CATEGORIES } from '../../src/lib/broadcastPurpose';
import { isRecipientEligible } from '../../src/lib/broadcastPreflight';
import { resolveVariableMapping, variableMappingSchema } from '../../src/lib/broadcastVariableMapping';
import { renderTemplateText } from '../../src/lib/broadcastTemplateRender';

describe('purposeForCategory', () => {
  it('treats appointment, follow-up, payment and service templates as transactional', () => {
    for (const category of ['appointment', 'follow_up', 'payment_reminder', 'service']) {
      expect(purposeForCategory(category)).toBe('transactional');
    }
  });

  it('defaults unknown, empty and marketing categories to the stricter marketing rule', () => {
    expect(purposeForCategory('marketing')).toBe('marketing');
    expect(purposeForCategory(null)).toBe('marketing');
    expect(purposeForCategory(undefined)).toBe('marketing');
    expect(purposeForCategory('something_else')).toBe('marketing');
  });

  it('exposes every category with a purpose', () => {
    expect(TEMPLATE_CATEGORIES.every((c) => c.purpose === 'marketing' || c.purpose === 'transactional')).toBe(true);
  });
});

describe('service-message consent', () => {
  it('lets an unknown-consent lead receive a service message but not marketing', () => {
    const base = { consentState: 'unknown' as const, isSuppressed: false };
    expect(isRecipientEligible({ ...base, purpose: purposeForCategory('appointment') }).eligible).toBe(true);
    expect(isRecipientEligible({ ...base, purpose: purposeForCategory('marketing') }).eligible).toBe(false);
  });

  it('still blocks opt-outs and suppressed addresses for service messages', () => {
    expect(isRecipientEligible({ purpose: 'transactional', consentState: 'opted_out', isSuppressed: false }).eligible).toBe(false);
    expect(isRecipientEligible({ purpose: 'transactional', consentState: 'unknown', isSuppressed: true }).eligible).toBe(false);
  });
});

describe('context variable mapping', () => {
  it('accepts a context entry and rejects an unknown context key', () => {
    expect(variableMappingSchema.safeParse({ appointment_date: { source: 'context', key: 'appointment_date' } }).success).toBe(true);
    expect(variableMappingSchema.safeParse({ x: { source: 'context', key: 'not_a_key' } }).success).toBe(false);
  });

  it('resolves context values alongside lead fields', () => {
    const values = resolveVariableMapping(
      {
        first_name: { source: 'lead_field', field: 'fname' },
        appointment_time: { source: 'context', key: 'appointment_time' },
        counselor_name: { source: 'context', key: 'counselor_name' },
      },
      { fname: 'Amina' },
      { appointment_time: '3:30 PM', counselor_name: 'Roopa' },
    );
    expect(values).toEqual({ first_name: 'Amina', appointment_time: '3:30 PM', counselor_name: 'Roopa' });
  });

  it('omits a missing context value so rendering fails loudly instead of sending a blank', () => {
    const values = resolveVariableMapping({ appointment_date: { source: 'context', key: 'appointment_date' } }, { fname: 'Amina' }, {});
    expect(values).toEqual({});
    expect(() => renderTemplateText('Your appointment is on {{appointment_date}}', values)).toThrow();
  });
});
