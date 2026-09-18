import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { extractDocumentFields, isAnthropicConfigured } from '@/lib/anthropic';
import { checkRateLimit, recordFailedAttempt } from '@/lib/rateLimiter';
import { captureError } from '@/lib/errorTracking';

// Same auth bar as POST /api/leads itself (any authenticated staff member,
// no specific permission gate) - this only ever returns extracted text for
// the counsellor to review and edit into the create-lead form; it never
// writes anything.
const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_BYTES = 10 * 1024 * 1024; // 10MB

const GENDER_VALUES = new Set(['Male', 'Female', 'Other']);

export async function POST(request: NextRequest) {
  const token = request.cookies.get('auth-token')?.value
    || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const currentUser = token ? verifyToken(token) : null;
  if (!currentUser) {
    return NextResponse.json({ error: 'Authentication is required' }, { status: 401 });
  }

  if (!isAnthropicConfigured()) {
    return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not configured' }, { status: 503 });
  }

  // Throttle by actor id - an LLM vision call has real per-request cost.
  const rateLimitKey = `extract-document:${currentUser.id}`;
  const rateLimit = checkRateLimit(rateLimitKey, { windowMs: 15 * 60 * 1000, maxAttempts: 15 });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many document scans in a short time. Please try again in a few minutes.' },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } }
    );
  }
  recordFailedAttempt(rateLimitKey, { windowMs: 15 * 60 * 1000 });

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 });
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: 'Only JPEG, PNG, or WEBP images are supported' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'Image is too large (max 10MB)' }, { status: 400 });
    }

    const imageBase64 = Buffer.from(await file.arrayBuffer()).toString('base64');

    const instructions = `Extract identity fields from this passport or government ID photo. Respond with ONLY a JSON object (no markdown fencing, no explanation) with exactly these keys:
- "firstName": given name as a string, or null if not legible
- "lastName": surname/family name as a string, or null if not legible
- "dateOfBirth": date of birth in YYYY-MM-DD format, or null if not legible
- "gender": one of "Male", "Female", "Other", or null if not stated

If this image does not appear to be a passport or government-issued ID, return all four fields as null. Do not guess or invent values you can't actually read.`;

    let extracted: Record<string, unknown>;
    try {
      extracted = await extractDocumentFields({ imageBase64, mediaType: file.type, instructions });
    } catch (error) {
      captureError(error, { route: 'POST /api/leads/extract-document', userId: currentUser.id });
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to read the document' }, { status: 502 });
    }

    // Sanitize into exactly the shape the create-lead form expects - never
    // pass the model's raw output straight through.
    const firstName = typeof extracted.firstName === 'string' ? extracted.firstName.trim().slice(0, 100) : null;
    const lastName = typeof extracted.lastName === 'string' ? extracted.lastName.trim().slice(0, 100) : null;
    const dateOfBirth = typeof extracted.dateOfBirth === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(extracted.dateOfBirth)
      ? extracted.dateOfBirth
      : null;
    const gender = typeof extracted.gender === 'string' && GENDER_VALUES.has(extracted.gender) ? extracted.gender : null;

    return NextResponse.json({ firstName, lastName, dateOfBirth, gender });
  } catch (error) {
    console.error('Error extracting document fields:', error);
    captureError(error, { route: 'POST /api/leads/extract-document' });
    return NextResponse.json({ error: 'Failed to read the document' }, { status: 500 });
  }
}
