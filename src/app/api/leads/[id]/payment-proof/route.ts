import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { requireAuth, isAuthError } from '@/lib/apiAuth';

const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
  'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const MAX_SIZE_BYTES = 4.5 * 1024 * 1024; // Vercel serverless request body cap.

// Uploads proof of payment for a lead that does not have a crm_opportunities row yet
// (lead-to-opportunity creates that row from the payment stage - the proof has to exist
// first so its URL can go in that request). Deliberately not /api/opportunity-documents:
// that route requires an opportunityId, which is exactly what's still missing here. This
// is a small server-side multipart upload (put() from @vercel/blob, same as
// /api/opportunity-documents) rather than the direct-to-blob client-token protocol
// /api/blob/upload implements for the web wizard - simpler and more portable for the
// mobile app, at the cost of the same ~4.5MB body limit /api/opportunity-documents already
// accepts. Compress images client-side before uploading if this ever becomes a problem.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(request, ['leads.update', 'leads.create']);
  if (isAuthError(auth)) return auth;

  try {
    const { id } = await params;
    const leadId = Number.parseInt(id, 10);
    if (!Number.isFinite(leadId)) {
      return NextResponse.json({ error: 'Invalid lead id' }, { status: 400 });
    }

    const contentType = request.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json({ error: 'Expected multipart/form-data with a file field' }, { status: 400 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 });
    }
    if (!ALLOWED_CONTENT_TYPES.has(file.type)) {
      return NextResponse.json({ error: `Unsupported file type: ${file.type || 'unknown'}` }, { status: 415 });
    }
    if (file.size > MAX_SIZE_BYTES) {
      return NextResponse.json({ error: 'File is too large (max 4.5MB).' }, { status: 413 });
    }

    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const fileName = `${Date.now()}_${safeName}`;
    const blob = await put(`payment-proofs/lead-${leadId}/${fileName}`, file, {
      access: 'public',
      addRandomSuffix: true,
    });

    return NextResponse.json({ url: blob.url }, { status: 201 });
  } catch (error) {
    console.error('Failed to upload payment proof:', error);
    return NextResponse.json({ error: 'Failed to upload payment proof' }, { status: 500 });
  }
}
