/**
 * Pure rendering for "Send template" emails (no DB, unit-testable).
 *
 * Tokens are `{{namespace.field}}` (lead.*, employee.*, branch.*, company.*).
 * Rendering is lenient on purpose: an unresolved token becomes empty text and is
 * reported in `missing`, so the sender sees what is blank in the preview instead
 * of the whole send failing. Values are HTML-escaped in the HTML body.
 */

const TOKEN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (ch) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string
));

export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|div|tr|h[1-6]|li|table)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function fillTokens(text: string | null | undefined, values: Record<string, string>, html: boolean, missing?: Set<string>): string {
  return (text || '').replace(TOKEN, (_match, name: string) => {
    const value = values[name];
    if (!value) { missing?.add(name); return ''; }
    return html ? escapeHtml(value) : value;
  });
}

export interface EmailVersionContent {
  components: { subject?: string } | null;
  exportHtml?: string | null;
  exportText?: string | null;
}

export interface RenderedEmail { subject: string; html: string; text: string; missing: string[] }

export function renderEmail(content: EmailVersionContent, values: Record<string, string>): RenderedEmail {
  const missing = new Set<string>();
  // A subject is a single line: collapse anything a value (or the template) put across lines.
  const subject = fillTokens(content.components?.subject, values, false, missing).replace(/[\r\n]+/g, ' ').trim();

  let html: string;
  if (content.exportHtml) {
    html = fillTokens(content.exportHtml, values, true, missing);
  } else {
    const body = fillTokens(content.exportText, values, true, missing);
    html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;white-space:pre-wrap">${body}</div>`;
  }
  const text = content.exportText ? fillTokens(content.exportText, values, false, missing) : htmlToText(html);
  return { subject, html, text, missing: [...missing] };
}

/** Variables a template uses, across subject and body. */
export function templateVariables(content: EmailVersionContent): string[] {
  const found = new Set<string>();
  for (const source of [content.components?.subject, content.exportHtml, content.exportText]) {
    for (const match of (source || '').matchAll(TOKEN)) found.add(match[1]);
  }
  return [...found];
}
