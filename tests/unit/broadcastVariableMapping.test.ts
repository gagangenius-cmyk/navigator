import { describe, expect, it } from 'vitest';
import {
  resolveRecipientAddress,
  resolveVariableMapping,
  variableMappingSchema,
} from '../../src/lib/broadcastVariableMapping';

describe('variableMappingSchema', () => {
  it('accepts a mix of lead_field and static entries', () => {
    const result = variableMappingSchema.safeParse({
      first_name: { source: 'lead_field', field: 'fname' },
      branch_name: { source: 'static', value: 'Dubai' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a lead_field not on the allowlist', () => {
    const result = variableMappingSchema.safeParse({
      x: { source: 'lead_field', field: 'password_hash' },
    });
    expect(result.success).toBe(false);
  });
});

describe('resolveVariableMapping', () => {
  it('pulls a lead_field value from the lead record', () => {
    const values = resolveVariableMapping(
      { first_name: { source: 'lead_field', field: 'fname' } },
      { fname: 'Aisha' }
    );
    expect(values).toEqual({ first_name: 'Aisha' });
  });

  it('uses a static value as-is regardless of the lead record', () => {
    const values = resolveVariableMapping(
      { branch_name: { source: 'static', value: 'Dubai Office' } },
      {}
    );
    expect(values).toEqual({ branch_name: 'Dubai Office' });
  });

  it('omits (does not render as empty string) a lead_field with no value', () => {
    const values = resolveVariableMapping(
      { first_name: { source: 'lead_field', field: 'fname' } },
      { fname: null }
    );
    expect(values).toEqual({});
  });
});

describe('resolveRecipientAddress', () => {
  it('uses email for the email channel', () => {
    expect(resolveRecipientAddress({ email: 'a@b.com', mobile: '123' }, 'email')).toBe('a@b.com');
  });

  it('prefers whatsapp_number over mobile for the whatsapp channel', () => {
    expect(resolveRecipientAddress({ whatsapp_number: '971500000000', mobile: '971511111111' }, 'whatsapp')).toBe('971500000000');
  });

  it('falls back to mobile for whatsapp when whatsapp_number is empty', () => {
    expect(resolveRecipientAddress({ whatsapp_number: '', mobile: '971511111111' }, 'whatsapp')).toBe('971511111111');
  });

  it('uses mobile for the sms channel', () => {
    expect(resolveRecipientAddress({ mobile: '971511111111' }, 'sms')).toBe('971511111111');
  });

  it('returns null when no usable address exists', () => {
    expect(resolveRecipientAddress({}, 'email')).toBeNull();
  });
});
