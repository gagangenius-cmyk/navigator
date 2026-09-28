// Variable substitution and SMS segment estimation for the template library
// (docs/broadcast-architecture.md, Phase 2). Every channel uses the same
// `{{name}}` token syntax in crm_message_template_versions.components -
// WhatsApp's provider constraint (Meta only allows positional "{{1}}",
// "{{2}}", ... in body text) is just a naming convention within that same
// token shape, not a different syntax, so one regex covers every channel.

const TOKEN_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function extractVariableTokens(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    names.add(match[1]);
  }
  return [...names];
}

export class MissingTemplateVariablesError extends Error {
  missing: string[];
  constructor(missing: string[]) {
    super(`Missing required template variable(s): ${missing.join(', ')}`);
    this.name = 'MissingTemplateVariablesError';
    this.missing = missing;
  }
}

// Renders every {{name}} token found in `text`. Throws
// MissingTemplateVariablesError (never silently sends a half-filled
// message) if any token has no corresponding value - callers that want a
// preview with gaps should use extractVariableTokens() + their own
// placeholder fill instead of this function.
export function renderTemplateText(text: string, values: Record<string, string>): string {
  const missing = new Set<string>();
  const rendered = text.replace(TOKEN_PATTERN, (_match, name: string) => {
    const value = values[name];
    if (value === undefined || value === null || value === '') {
      missing.add(name);
      return '';
    }
    return value;
  });

  if (missing.size > 0) {
    throw new MissingTemplateVariablesError([...missing]);
  }
  return rendered;
}

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch]);
}

// Same substitution as renderTemplateText(), but for tokens embedded in an
// HTML document (a template's exportHtml). Values come from lead/contact
// fields (name, etc.), which are end-user-controlled - substituting them
// into HTML unescaped would let a lead inject markup/script into outbound
// campaign and workflow emails sent from the company's own domain.
export function renderTemplateHtml(html: string, values: Record<string, string>): string {
  const missing = new Set<string>();
  const rendered = html.replace(TOKEN_PATTERN, (_match, name: string) => {
    const value = values[name];
    if (value === undefined || value === null || value === '') {
      missing.add(name);
      return '';
    }
    return escapeHtml(value);
  });

  if (missing.size > 0) {
    throw new MissingTemplateVariablesError([...missing]);
  }
  return rendered;
}

// GSM 03.38 default alphabet (basic + extended tables). A message using only
// these characters can be sent as GSM-7; any other character (emoji, most
// non-Latin scripts, curly quotes, em dashes, ...) forces the whole message
// to UCS-2, which is why this checks every character, not just a sample.
const GSM_7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\x1BÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
// Extended-table characters are sent as a 2-character GSM-7 escape sequence
// (ESC + code), so each one counts double against the segment limit.
const GSM_7_EXTENDED = '^{}\\[~]|€';

export interface SmsSegmentEstimate {
  encoding: 'GSM_7' | 'UCS_2';
  /** Encoded length: GSM-7 extended chars count as 2; UCS-2 counts Unicode code points. */
  length: number;
  segments: number;
  charsPerSegment: number;
}

export function estimateSmsSegments(text: string): SmsSegmentEstimate {
  const codePoints = [...text];
  const isGsm7 = codePoints.every((ch) => GSM_7_BASIC.includes(ch) || GSM_7_EXTENDED.includes(ch));

  if (isGsm7) {
    const length = codePoints.reduce((sum, ch) => sum + (GSM_7_EXTENDED.includes(ch) ? 2 : 1), 0);
    const singleSegmentLimit = 160;
    const multiSegmentLimit = 153; // concatenated SMS spends 7 chars per segment on the UDH header
    const segments = length <= singleSegmentLimit ? 1 : Math.ceil(length / multiSegmentLimit);
    return { encoding: 'GSM_7', length, segments, charsPerSegment: segments === 1 ? singleSegmentLimit : multiSegmentLimit };
  }

  const length = codePoints.length;
  const singleSegmentLimit = 70;
  const multiSegmentLimit = 67;
  const segments = length <= singleSegmentLimit ? 1 : Math.ceil(length / multiSegmentLimit);
  return { encoding: 'UCS_2', length, segments, charsPerSegment: segments === 1 ? singleSegmentLimit : multiSegmentLimit };
}
