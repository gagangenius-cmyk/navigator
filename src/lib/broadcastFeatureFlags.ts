// Master kill switch for the Broadcast Center / Template Library / Workflow
// Automation / Bot Builder feature area (docs/broadcast-architecture.md).
// Phase 1 ships schema/models only, so nothing calls this yet - it exists so
// Phase 3+ API routes/cron consumers have a single flag to gate on from day
// one, matching this codebase's existing on/off switches (e.g.
// META_INTEGRATION_ENABLED, RENEWAL_REMINDER_CRON_ENABLED).
export function isBroadcastAutomationEnabled(): boolean {
  return process.env.BROADCAST_AUTOMATION_ENABLED === 'true';
}
