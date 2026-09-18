// Thin wrapper over the Claude Messages API via plain `fetch` - matches this
// codebase's established style for third-party APIs (mailer.ts/Resend,
// whatsapp.ts/Meta, errorTracking.ts/Sentry: no SDK, one fetch call, throws
// a descriptive error the caller catches). ANTHROPIC_API_KEY is an empty
// placeholder in .env until a real key is supplied.
//
// Model defaults to Haiku - every current use (draft-remark suggestions) is
// a short, cheap text-generation task; override via ANTHROPIC_MODEL for a
// task that needs Sonnet/Opus-level quality.
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const ANTHROPIC_VERSION = '2023-06-01';

export async function generateText({ system, prompt, maxTokens = 300 }: {
  system?: string;
  prompt: string;
  maxTokens?: number;
}): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Claude API error: ${res.status} ${body}`);
  }

  const json = await res.json();
  const text = json?.content?.find((block: { type: string }) => block.type === 'text')?.text;
  if (typeof text !== 'string') {
    throw new Error('Claude API returned no text content');
  }
  return text;
}

export const isAnthropicConfigured = (): boolean => Boolean(process.env.ANTHROPIC_API_KEY);

// Higher-accuracy model for document extraction (passport/ID OCR) than the
// Haiku default above - this feeds fields a counsellor may accept as-is into
// an official record, so extraction quality matters more than per-call cost
// here. Override via ANTHROPIC_VISION_MODEL independently of ANTHROPIC_MODEL.
const DEFAULT_VISION_MODEL = 'claude-sonnet-5';

// Sends one image and asks for a strict-JSON response matching the given
// field list - used for passport/ID auto-fill (src/app/api/leads/extract-document).
// Returns the parsed object as-is; callers validate/sanitize the fields they
// care about rather than trusting this blindly, since a vision model can
// still misread a field or return one that's missing/malformed.
export async function extractDocumentFields({ imageBase64, mediaType, instructions }: {
  imageBase64: string;
  mediaType: string;
  instructions: string;
}): Promise<Record<string, unknown>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_VISION_MODEL || DEFAULT_VISION_MODEL,
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
          { type: 'text', text: instructions },
        ],
      }],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Claude API error: ${res.status} ${body}`);
  }

  const json = await res.json();
  const text = json?.content?.find((block: { type: string }) => block.type === 'text')?.text;
  if (typeof text !== 'string') {
    throw new Error('Claude API returned no text content');
  }

  // Strip a ```json ... ``` fence if the model added one despite being asked
  // not to - cheap to handle, common enough to be worth it.
  const jsonText = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(jsonText);
  } catch {
    throw new Error('Claude API response was not valid JSON');
  }
}
