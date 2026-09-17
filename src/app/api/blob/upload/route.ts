import { NextRequest, NextResponse } from 'next/server';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { del } from '@vercel/blob';
import { verifyToken } from '@/lib/auth';
import { logAudit } from '@/lib/auditLog';

const ALLOWED_CONTENT_TYPES = [
  'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

// `allowedContentTypes` above (enforced by Vercel Blob at upload time) only
// ever checks the *declared* content-type header the browser sent - nothing
// in a direct-to-blob upload inspects the actual bytes, so a renamed
// executable declared as application/pdf would sail through. This is the
// first few bytes of each allowed type's real file signature, checked
// after the fact in onUploadCompleted() below (the one point in this flow
// where the server can read the uploaded bytes at all).
const MAGIC_BYTE_CHECKS: Record<string, (bytes: Uint8Array) => boolean> = {
  'application/pdf': (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46, // %PDF
  'image/jpeg': (b) => b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF,
  'image/jpg': (b) => b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF,
  'image/png': (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47,
  'image/gif': (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38, // GIF8
  'image/webp': (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50, // RIFF....WEBP
  'application/msword': (b) => b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0, // legacy OLE
  // .docx/.xlsx are both zip containers - same signature, no finer-grained check possible from 16 bytes.
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': (b) => b[0] === 0x50 && b[1] === 0x4B,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': (b) => b[0] === 0x50 && b[1] === 0x4B,
};

// Fails open (returns true) on any fetch/network problem - a transient blip
// reading the blob back must never destroy a legitimate upload. Only an
// actual, successfully-read signature mismatch triggers removal.
async function matchesDeclaredType(url: string, contentType: string): Promise<boolean> {
  const check = MAGIC_BYTE_CHECKS[contentType];
  if (!check) return true;
  try {
    const response = await fetch(url, { headers: { Range: 'bytes=0-15' } });
    if (!response.ok) return true;
    const bytes = new Uint8Array(await response.arrayBuffer());
    return check(bytes);
  } catch {
    return true;
  }
}

// Shared token-broker route for every direct-to-Blob client upload in the app
// (proof of payment, signed agreements, opportunity documents, operations
// documents, calendar images). The browser uploads the file bytes straight to
// Vercel Blob — this route only ever sees a small JSON handshake, so it never
// hits the ~4.5MB request-body limit that a normal multipart POST would.
export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        const token = request.cookies.get('auth-token')?.value
          || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
        const user = token ? verifyToken(token) : null;
        if (!user) {
          throw new Error('Authentication is required to upload files');
        }

        return {
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes: 25 * 1024 * 1024, // 25MB
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({ userId: user.id, pathname }),
        };
      },
      // Post-hoc content verification only - callers still make their own
      // explicit follow-up request once upload() resolves client-side for
      // anything that must happen synchronously, since this callback only
      // fires when Vercel Blob can reach this app over the public internet,
      // which localhost can't during dev (so this check is production-only).
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        if (await matchesDeclaredType(blob.url, blob.contentType)) return;

        await del(blob.url).catch((error) => {
          console.error('Failed to remove blob with mismatched content:', error);
        });

        let userId: number | null = null;
        try {
          userId = tokenPayload ? (JSON.parse(tokenPayload)?.userId ?? null) : null;
        } catch {
          // tokenPayload wasn't valid JSON - leave actor unattributed rather than fail the removal.
        }
        await logAudit({
          entityType: 'blob_upload',
          entityId: blob.pathname,
          action: 'upload_rejected_content_mismatch',
          summary: `Upload removed: file content didn't match declared type (${blob.contentType})`,
          actorId: userId,
        });
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Upload failed' },
      { status: 400 },
    );
  }
}
