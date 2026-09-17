import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/sequelize';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { getJobQueueSummary, retryFailedJob } from '@/lib/jobQueue';
import { listRecentCronRuns } from '@/lib/cronRunLog';
import { logAudit } from '@/lib/auditLog';
import { captureError } from '@/lib/errorTracking';

let dbReady = false;
const ensureDB = async () => { if (!dbReady) { await connectDB(); dbReady = true; } };

// Same admin-only gate as the audit log - this surfaces internal system
// state (queued job payloads, cron failures), not a business record.
const REQUIRED_PERMISSIONS = ['roles.manage', 'admin.access'];

export async function GET(request: NextRequest) {
  const auth = requireAuth(request, REQUIRED_PERMISSIONS);
  if (isAuthError(auth)) return auth;
  try {
    await ensureDB();
    const [jobQueue, cronRuns] = await Promise.all([
      getJobQueueSummary(),
      listRecentCronRuns(50),
    ]);
    return NextResponse.json({ jobQueue, cronRuns });
  } catch (error) {
    console.error('Error fetching system jobs:', error);
    captureError(error, { route: 'GET /api/system-jobs' });
    return NextResponse.json({ error: 'Failed to fetch system jobs' }, { status: 500 });
  }
}

// Retry is the only mutation this route allows - it never lets a caller
// edit/cancel a job directly, matching the audit log's read-mostly posture.
export async function POST(request: NextRequest) {
  const auth = requireAuth(request, REQUIRED_PERMISSIONS);
  if (isAuthError(auth)) return auth;
  try {
    await ensureDB();
    const body = await request.json().catch(() => ({}));
    const jobId = Number.parseInt(String(body.jobId || ''), 10);
    if (!Number.isFinite(jobId)) {
      return NextResponse.json({ error: 'Valid jobId is required' }, { status: 400 });
    }

    const retried = await retryFailedJob(jobId);
    if (!retried) {
      return NextResponse.json({ error: 'Job not found or not in a failed state' }, { status: 404 });
    }

    await logAudit({
      entityType: 'job_queue',
      entityId: jobId,
      action: 'job_retried',
      summary: `Job #${jobId} manually retried`,
      actorId: auth.id,
      actorRole: auth.roleName || auth.type || null,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error retrying job:', error);
    captureError(error, { route: 'POST /api/system-jobs' });
    return NextResponse.json({ error: 'Failed to retry job' }, { status: 500 });
  }
}
