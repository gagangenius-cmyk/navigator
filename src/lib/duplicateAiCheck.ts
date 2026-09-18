import { generateText } from './anthropic';
import { logLeadRemark } from './leadRemarks';
import type { FuzzyDuplicateMatch } from './duplicateLeadCheck';

// A judgment-call layer on top of checkForFuzzyDuplicate() (duplicateLeadCheck.ts),
// not a replacement for it. That function's SOUNDEX+Levenshtein pipeline
// narrows and ranks candidates cheaply and already works well - this only
// asks an LLM to look at the small candidate set it already produced (never
// more than 5) and give a plain-English verdict, since a numeric similarity
// score alone can't distinguish "70% similar by coincidence, different
// person" from "60% similar due to transliteration, same person" the way a
// model that actually understands names can.

export interface DuplicateAiInput {
  fname: string | null | undefined;
  lname: string | null | undefined;
  email: string | null | undefined;
  phone: string | null | undefined;
  dob: string | null | undefined;
  nationality: string | null | undefined;
}

export interface DuplicateAiVerdict {
  candidateId: number;
  verdict: 'likely_same' | 'possibly_same' | 'likely_different';
  confidence: number;
  reasoning: string;
}

export async function checkDuplicatesWithAI(
  newLead: DuplicateAiInput,
  candidates: FuzzyDuplicateMatch[]
): Promise<DuplicateAiVerdict[]> {
  if (!candidates.length) return [];

  const candidateLines = candidates.map((c, i) =>
    `${i + 1}. id=${c.id}: "${c.fname || ''} ${c.lname || ''}".trim(), email=${c.email || 'unknown'}, phone=${c.phone || 'unknown'}, dob=${c.dob || 'unknown'}, nationality=${c.nationality || 'unknown'} (flagged by name-similarity: ${c.matchReason})`
  ).join('\n');

  const prompt = `A new lead is being created at an immigration consultancy. The system's fuzzy name-matching already flagged these existing leads as possibly the same person - your job is to give a human reviewer a plain-English second opinion, accounting for things pure string similarity can't judge: name transliteration (e.g. "Mohammed"/"Mohamed"/"Muhammad" are very likely the same name), nicknames, and whether email/phone/DOB/nationality corroborate or contradict a match.

New lead: "${newLead.fname || ''} ${newLead.lname || ''}".trim(), email=${newLead.email || 'unknown'}, phone=${newLead.phone || 'unknown'}, dob=${newLead.dob || 'unknown'}, nationality=${newLead.nationality || 'unknown'}

Candidates already flagged by name similarity:
${candidateLines}

Respond with ONLY a JSON array (no markdown fencing, no explanation outside the JSON), one object per candidate, each with exactly these keys:
- "candidateId": the candidate's id (number)
- "verdict": one of "likely_same", "possibly_same", "likely_different"
- "confidence": a number 0-100
- "reasoning": one short sentence explaining the verdict`;

  const text = await generateText({ prompt, maxTokens: 500 });
  const jsonText = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const parsed = JSON.parse(jsonText);
  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter((v): v is Record<string, unknown> => Boolean(v) && typeof v === 'object')
    .map((v) => ({
      candidateId: Number(v.candidateId),
      verdict: ['likely_same', 'possibly_same', 'likely_different'].includes(String(v.verdict))
        ? (v.verdict as DuplicateAiVerdict['verdict'])
        : 'possibly_same',
      confidence: Math.max(0, Math.min(100, Number(v.confidence) || 0)),
      reasoning: typeof v.reasoning === 'string' ? v.reasoning.slice(0, 300) : '',
    }))
    .filter((v) => candidates.some((c) => c.id === v.candidateId));
}

// Fire-and-forget hook for POST /api/leads: runs the AI verdict in the
// background (never awaited by the caller, matching notifyMetaLeadQuality's
// contract) and, for anything the model considers likely the same person,
// logs it onto the EXISTING candidate lead's own activity history - so
// whoever owns that lead sees it next time they open it, without this ever
// blocking or slowing down the lead-creation request itself.
export function checkDuplicatesWithAIInBackground(
  newLeadId: number,
  newLead: DuplicateAiInput,
  candidates: FuzzyDuplicateMatch[]
): void {
  if (!candidates.length) return;
  void (async () => {
    try {
      const verdicts = await checkDuplicatesWithAI(newLead, candidates);
      const newLeadName = [newLead.fname, newLead.lname].filter(Boolean).join(' ') || `Lead #${newLeadId}`;
      for (const verdict of verdicts) {
        if (verdict.verdict === 'likely_different') continue;
        await logLeadRemark({
          leadId: verdict.candidateId,
          action: 'duplicate_detected',
          remark: `AI duplicate check: new lead #${newLeadId} (${newLeadName}) looks ${verdict.verdict === 'likely_same' ? 'very likely' : 'possibly'} the same person (${verdict.confidence}% confidence) - ${verdict.reasoning}`,
        });
      }
    } catch (error) {
      console.error(`[AI Duplicate Check] Unhandled error for new lead ${newLeadId}:`, error);
    }
  })();
}
