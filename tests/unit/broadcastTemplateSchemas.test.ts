import { describe, expect, it } from 'vitest';
import {
  componentsSchemaForChannel,
  emailTemplateComponentsSchema,
  smsTemplateComponentsSchema,
  templateVariableSchemaArray,
  whatsappTemplateComponentsSchema,
} from '../../src/lib/broadcastTemplateSchemas';

describe('whatsappTemplateComponentsSchema', () => {
  it('accepts a minimal valid template: body only', () => {
    const result = whatsappTemplateComponentsSchema.safeParse({ body: { text: 'Hello {{1}}, your case is ready.' } });
    expect(result.success).toBe(true);
  });

  it('accepts a full template with header/footer/buttons', () => {
    const result = whatsappTemplateComponentsSchema.safeParse({
      header: { format: 'TEXT', text: 'Update on {{1}}' },
      body: { text: 'Hi {{1}}, your case {{2}} is ready.' },
      footer: { text: 'Reply STOP to opt out' },
      buttons: [
        { type: 'QUICK_REPLY', text: 'Yes' },
        { type: 'URL', text: 'View', url: 'https://example.com/case/{{1}}' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an IMAGE/VIDEO/DOCUMENT header that also carries text', () => {
    const result = whatsappTemplateComponentsSchema.safeParse({
      header: { format: 'IMAGE', text: 'not allowed on a media header' },
      body: { text: 'Body text' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects more than 10 buttons', () => {
    const result = whatsappTemplateComponentsSchema.safeParse({
      body: { text: 'Body' },
      buttons: Array.from({ length: 11 }, (_, i) => ({ type: 'QUICK_REPLY', text: `Option ${i}` })),
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty body', () => {
    const result = whatsappTemplateComponentsSchema.safeParse({ body: { text: '' } });
    expect(result.success).toBe(false);
  });
});

describe('emailTemplateComponentsSchema', () => {
  it('accepts subject + designJson (Unlayer JSON stored opaquely)', () => {
    const result = emailTemplateComponentsSchema.safeParse({
      subject: 'Welcome, {{first_name}}!',
      preheader: 'Your journey starts here',
      designJson: { body: { rows: [] }, counters: { u_row: 1 } },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a missing subject', () => {
    const result = emailTemplateComponentsSchema.safeParse({ preheader: 'x' });
    expect(result.success).toBe(false);
  });
});

describe('smsTemplateComponentsSchema', () => {
  it('accepts plain text', () => {
    expect(smsTemplateComponentsSchema.safeParse({ text: 'Your OTP is {{otp}}' }).success).toBe(true);
  });

  it('rejects text over the 1600-char ceiling (~10 GSM-7 segments)', () => {
    expect(smsTemplateComponentsSchema.safeParse({ text: 'a'.repeat(1601) }).success).toBe(false);
  });
});

describe('componentsSchemaForChannel', () => {
  it('routes each channel to its own schema', () => {
    expect(componentsSchemaForChannel('whatsapp')).toBe(whatsappTemplateComponentsSchema);
    expect(componentsSchemaForChannel('email')).toBe(emailTemplateComponentsSchema);
    expect(componentsSchemaForChannel('sms')).toBe(smsTemplateComponentsSchema);
  });
});

describe('templateVariableSchemaArray', () => {
  it('accepts a well-formed variable list with defaults applied', () => {
    const result = templateVariableSchemaArray.safeParse([{ name: 'first_name' }]);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data[0]).toEqual({ name: 'first_name', type: 'string', required: true });
    }
  });

  it('rejects a variable name that would not match its own {{name}} token pattern', () => {
    const result = templateVariableSchemaArray.safeParse([{ name: 'first name' }]);
    expect(result.success).toBe(false);
  });
});
