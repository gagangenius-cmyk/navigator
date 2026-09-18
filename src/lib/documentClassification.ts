import { extractDocumentFields, isAnthropicConfigured } from './anthropic';

// Verifies an uploaded client-portal document actually looks like what the
// checklist item said it should be (e.g. a client clicks "Passport Copy" but
// uploads an unrelated photo by mistake) - reuses extractDocumentFields()'s
// generic vision-call-that-returns-JSON shape from the OCR auto-fill feature
// rather than adding a near-duplicate function.
//
// Never blocks the upload - this only ever runs as a fire-and-forget check
// after the file is already saved (see src/app/api/clientportal/upload/route.ts),
// flagging a mismatch for a human reviewer rather than auto-rejecting. A
// vision model can misjudge an unusual but legitimate document, and blocking
// a real client's real passport upload over a false positive would be a much
// worse outcome than a false negative slipping through to manual review.

export interface DocumentCheckResult {
  matches: boolean;
  confidence: number;
  note: string;
}

export async function classifyDocumentMatch({
  imageBase64,
  mediaType,
  expectedLabel,
}: {
  imageBase64: string;
  mediaType: string;
  expectedLabel: string;
}): Promise<DocumentCheckResult | null> {
  if (!isAnthropicConfigured()) return null;

  const instructions = `This image was uploaded by a client at an immigration consultancy against a checklist item labeled "${expectedLabel}". Does the image actually look like that kind of document? Respond with ONLY a JSON object (no markdown fencing) with exactly these keys:
- "matches": true or false
- "confidence": a number 0-100
- "note": one short sentence explaining your judgment

If the image is unreadable, blank, or clearly not a document at all, set "matches" to false.`;

  const result = await extractDocumentFields({ imageBase64, mediaType, instructions });
  return {
    matches: Boolean(result.matches),
    confidence: Math.max(0, Math.min(100, Number(result.confidence) || 0)),
    note: typeof result.note === 'string' ? result.note.slice(0, 300) : '',
  };
}
