import { describe, expect, it } from 'vitest';
import { escapeHtml } from '@/lib/escapeHtml';
import { buildReceiptHtml, type ReceiptFields } from '@/lib/receiptTemplate';

describe('escapeHtml', () => {
  it('escapes markup characters and tolerates null', () => {
    expect(escapeHtml(`<img src=x onerror="a('b')">&`)).toBe('&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;');
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(12)).toBe('12');
  });
});

describe('buildReceiptHtml', () => {
  it('does not let client-controlled text inject markup', () => {
    const payload = '<img src=x onerror=alert(1)>';
    const html = buildReceiptHtml({
      clientName: payload,
      remark: payload,
      transactionId: payload,
      paymentMethod: 'cash',
      amount: 100,
    } as unknown as ReceiptFields);
    expect(html).not.toContain(payload);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});
