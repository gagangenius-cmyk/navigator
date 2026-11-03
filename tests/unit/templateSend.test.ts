import { describe, it, expect } from 'vitest';
import { renderEmail, templateVariables, fillTokens, htmlToText } from '@/lib/templateSend/render';
import { withFlatAliases } from '@/lib/templateSend/values';

describe('renderEmail', () => {
  const content = {
    components: { subject: 'Hello {{first_name}} - {{appointment_date}}' },
    exportHtml: '<p>Hi {{lead.first_name}}, see {{counselor_name}}. {{missing.thing}}</p>',
    exportText: 'Hi {{lead.first_name}}, see {{counselor_name}}.',
  };

  it('fills both token styles and reports what stayed empty', () => {
    const values = withFlatAliases(
      { 'lead.first_name': 'Asha', 'employee.name': 'Ravi' },
      { appointment_date: 'Monday 3 November 2026' },
    );
    const r = renderEmail(content, values);
    expect(r.subject).toBe('Hello Asha - Monday 3 November 2026');
    expect(r.html).toContain('Hi Asha, see Ravi.');
    expect(r.text).toBe('Hi Asha, see Ravi.');
    expect(r.missing).toEqual(['missing.thing']);
  });

  it('HTML-escapes values in the body but not in the plain-text subject', () => {
    const r = renderEmail(
      { components: { subject: 'For {{lead.full_name}}' }, exportHtml: '<p>{{lead.full_name}}</p>' },
      { 'lead.full_name': 'A <b>&"Co"' },
    );
    expect(r.html).toBe('<p>A &lt;b&gt;&amp;&quot;Co&quot;</p>');
    expect(r.subject).toBe('For A <b>&"Co"');
  });

  it('keeps the subject on one line even if a value contains newlines', () => {
    const r = renderEmail({ components: { subject: 'Hi {{lead.full_name}}' }, exportHtml: '<p>x</p>' }, { 'lead.full_name': 'A\r\nBcc: x@y.com' });
    expect(r.subject).not.toMatch(/[\r\n]/);
  });

  it('falls back to a text body when there is no HTML', () => {
    const r = renderEmail({ components: { subject: 's' }, exportText: 'Dear {{lead.first_name}}\nBye' }, { 'lead.first_name': 'Asha' });
    expect(r.html).toContain('Dear Asha');
    expect(r.text).toContain('Dear Asha');
  });

  it('lists the variables a template uses', () => {
    expect(templateVariables(content).sort()).toEqual(['appointment_date', 'counselor_name', 'first_name', 'lead.first_name', 'missing.thing']);
  });
});

describe('withFlatAliases', () => {
  it('maps namespaced values to the flat names stored starter templates use', () => {
    const v = withFlatAliases(
      { 'lead.first_name': 'Asha', 'lead.mobile': '+971500000000', 'employee.name': 'Ravi', 'branch.name': 'Dubai' },
      {},
    );
    expect(v).toMatchObject({ first_name: 'Asha', phone: '+971500000000', counselor_name: 'Ravi', branch_name: 'Dubai' });
  });

  it('prefers the appointment counsellor over the sender, and a namespaced key over an alias', () => {
    const v = withFlatAliases({ 'lead.email': 'a@b.co', email: 'ignored', 'employee.name': 'Sender' }, { counselor_name: 'Booked Counsellor' });
    expect(v.counselor_name).toBe('Booked Counsellor');
    expect(v.email).toBe('ignored');
  });
});

describe('helpers', () => {
  it('fillTokens is lenient and htmlToText strips markup', () => {
    expect(fillTokens('Hi {{ a.b }}!', {}, false)).toBe('Hi !');
    expect(htmlToText('<p>Hello&nbsp;<b>you</b></p><style>x{}</style>')).toBe('Hello you');
  });
});
