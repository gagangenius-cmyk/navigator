import { describe, expect, it } from 'vitest';
import {
  MissingTemplateVariablesError,
  estimateSmsSegments,
  extractVariableTokens,
  renderTemplateText,
} from '../../src/lib/broadcastTemplateRender';

describe('extractVariableTokens', () => {
  it('finds both named (email/SMS) and positional (WhatsApp) tokens with one regex', () => {
    expect(extractVariableTokens('Hi {{first_name}}, your case {{case_number}} is ready')).toEqual(['first_name', 'case_number']);
    expect(extractVariableTokens('Hello {{1}}, your code is {{2}}')).toEqual(['1', '2']);
  });

  it('deduplicates a token used more than once', () => {
    expect(extractVariableTokens('{{name}} ... {{name}} again')).toEqual(['name']);
  });

  it('returns an empty array for plain text with no tokens', () => {
    expect(extractVariableTokens('No variables here.')).toEqual([]);
  });
});

describe('renderTemplateText', () => {
  it('substitutes every token when all values are present', () => {
    expect(renderTemplateText('Hi {{first_name}}, welcome to {{branch}}', { first_name: 'Aisha', branch: 'Dubai' }))
      .toBe('Hi Aisha, welcome to Dubai');
  });

  it('throws MissingTemplateVariablesError rather than sending a half-filled message', () => {
    expect(() => renderTemplateText('Hi {{first_name}}', {})).toThrow(MissingTemplateVariablesError);
  });

  it('lists every missing variable, not just the first', () => {
    try {
      renderTemplateText('{{a}} and {{b}}', {});
      throw new Error('expected renderTemplateText to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(MissingTemplateVariablesError);
      expect((error as MissingTemplateVariablesError).missing.sort()).toEqual(['a', 'b']);
    }
  });

  it('treats an empty-string value as missing, not as a valid blank substitution', () => {
    expect(() => renderTemplateText('Hi {{first_name}}', { first_name: '' })).toThrow(MissingTemplateVariablesError);
  });
});

describe('estimateSmsSegments', () => {
  it('classifies plain ASCII/GSM-7 text as GSM_7 with a 160-char single segment', () => {
    const result = estimateSmsSegments('Your appointment is confirmed for tomorrow at 10am.');
    expect(result.encoding).toBe('GSM_7');
    expect(result.segments).toBe(1);
    expect(result.charsPerSegment).toBe(160);
  });

  it('forces UCS_2 (70-char segments) as soon as one non-GSM-7 character appears, e.g. an emoji', () => {
    const result = estimateSmsSegments('Congrats! 🎉');
    expect(result.encoding).toBe('UCS_2');
    expect(result.charsPerSegment).toBe(70);
  });

  it('switches to the 153-char multi-segment limit once GSM-7 text exceeds a single segment', () => {
    const longText = 'a'.repeat(200);
    const result = estimateSmsSegments(longText);
    expect(result.encoding).toBe('GSM_7');
    expect(result.segments).toBe(2); // ceil(200/153)
    expect(result.charsPerSegment).toBe(153);
  });

  it('counts a GSM-7 extended-table character (e.g. "{") as 2 chars toward the limit', () => {
    const withBrace = estimateSmsSegments('{');
    expect(withBrace.encoding).toBe('GSM_7');
    expect(withBrace.length).toBe(2);
  });
});
