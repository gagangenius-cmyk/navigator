export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
      throw new Error('JWT_SECRET must be set in production. Set it in .env.production before starting the server.');
    }

    const { startRenewalReminderCron } = await import('@/lib/renewal-reminder-cron');
    await startRenewalReminderCron();

    const { startMonthlyReportCron } = await import('@/lib/monthly-report-cron');
    await startMonthlyReportCron();

    const { startLeadPoolSlaCron } = await import('@/lib/lead-pool-sla-cron');
    await startLeadPoolSlaCron();

    const { startStaleLeadRecycleCron } = await import('@/lib/stale-lead-recycle-cron');
    await startStaleLeadRecycleCron();

    const { startJobQueueCron } = await import('@/lib/job-queue-cron');
    await startJobQueueCron();

    const { startLeadScoreCron } = await import('@/lib/lead-score-cron');
    await startLeadScoreCron();

    const { startContractReconciliationCron } = await import('@/lib/contract-reconciliation-cron');
    await startContractReconciliationCron();

    const { startMetaLeadsRetryCron } = await import('@/lib/meta-leads-retry-cron');
    await startMetaLeadsRetryCron();

    // Broadcast/workflow automation (docs/broadcast-architecture.md)
    // deliberately does NOT register a cron here, unlike every job above -
    // its worker (BullMQ Workers + scheduler) runs as its own standalone
    // process (`npm run worker`, see workers/index.ts), not inside the
    // Next.js server. The spec this feature was built against is explicit
    // that background workers must stay outside Vercel/serverless request
    // handling, and instrumentation.ts's register() only reliably behaves
    // like a long-lived process under `next start`/Docker - never under
    // Vercel's actual serverless functions, where nothing here would keep
    // polling between requests anyway.
  }
}

// Next.js's own catch-all for errors that escape a route/Server Component's
// own try/catch entirely (most API routes here already catch and return a
// normal error response themselves, so this is a backstop for what they
// don't - not full coverage on its own; see src/lib/errorTracking.ts's own
// comment for why route-by-route adoption still matters for the rest).
export async function onRequestError(
  error: unknown,
  request: { path: string; method: string },
) {
  const { captureError } = await import('@/lib/errorTracking');
  captureError(error, { route: `${request.method} ${request.path}` });
}
