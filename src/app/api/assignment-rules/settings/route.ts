import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { isCeo } from '@/lib/roleChecks';
import { getAssignmentSettings, updateAssignmentSettings } from '@/lib/assignmentSettings';

// CEO-facing on/off switches and SLA threshold for the automatic lead
// routing engine (src/lib/assignmentRuleEngine.ts) and its cron safety net
// (src/lib/lead-pool-sla-cron.ts). Previously LEAD_POOL_SLA_MINUTES was a
// deploy-time env var with no toggle at all - this makes both runtime,
// database-backed, and CEO-editable without a deploy.

export async function GET(request: NextRequest) {
  const auth = requireAuth(request, ['transfers.manage']);
  if (isAuthError(auth)) return auth;
  if (!isCeo(auth)) {
    return NextResponse.json({ success: false, error: 'Only the CEO can manage lead assignment settings' }, { status: 403 });
  }
  try {
    const settings = await getAssignmentSettings();
    return NextResponse.json({ success: true, settings });
  } catch (error) {
    console.error('Error fetching assignment settings:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch assignment settings' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const auth = requireAuth(request, ['transfers.manage']);
  if (isAuthError(auth)) return auth;
  if (!isCeo(auth)) {
    return NextResponse.json({ success: false, error: 'Only the CEO can manage lead assignment settings' }, { status: 403 });
  }
  try {
    const body = await request.json();
    const settings = await updateAssignmentSettings({
      roundRobinEnabled: body.roundRobinEnabled,
      slaSweepEnabled: body.slaSweepEnabled,
      poolSlaMinutes: body.poolSlaMinutes !== undefined ? Number(body.poolSlaMinutes) : undefined,
    }, auth.id);
    return NextResponse.json({ success: true, settings });
  } catch (error) {
    console.error('Error updating assignment settings:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to update assignment settings' },
      { status: 400 }
    );
  }
}
