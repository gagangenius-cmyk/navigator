import { NextRequest, NextResponse } from 'next/server';
import type { ModelStatic, Model } from 'sequelize';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { connectDB, sequelize } from '@/lib/sequelize';
import { CrmBroadcastCampaigns, CrmBroadcastRecipients, CrmWorkflowEnrollments, CrmWorkflowStepExecutions } from '@/models';
import { checkDailyQuota } from '@/lib/broadcastRateLimit';

let dbReady = false;
const ensureDb = async () => {
  if (!dbReady) {
    await connectDB();
    dbReady = true;
  }
};

async function countsByColumn(model: ModelStatic<Model>, column: string): Promise<Record<string, number>> {
  const rows = await model.findAll({
    attributes: [column, [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
    group: [column],
    raw: true,
  }) as unknown as Record<string, string>[];
  return Object.fromEntries(rows.map((row) => [row[column], Number(row.count)]));
}

// Phase 6's "campaign funnel, quota reporting, dead-letter inspection"
// slice - built entirely from data the existing tables already record, no
// new tables. Load testing and a full observability stack (Phase 6's other
// asks) are not something a query endpoint can provide - see
// docs/broadcast-architecture.md.
export async function GET(request: NextRequest) {
  const auth = requireAuth(request, ['campaigns.manage']);
  if (isAuthError(auth)) return auth;
  try {
    await ensureDb();

    const [campaignsByStatus, recipientsByStatus, enrollmentsByStatus, stepsByStatus] = await Promise.all([
      countsByColumn(CrmBroadcastCampaigns, 'status'),
      countsByColumn(CrmBroadcastRecipients, 'status'),
      countsByColumn(CrmWorkflowEnrollments, 'status'),
      countsByColumn(CrmWorkflowStepExecutions, 'status'),
    ]);

    // "Dead-letter inspection": the most recent genuinely failed items -
    // these are exactly what a human needs to see to figure out why
    // something didn't go out.
    const failedRecipients = await CrmBroadcastRecipients.findAll({
      where: { status: 'failed' },
      order: [['updatedAt', 'DESC']],
      limit: 20,
      attributes: ['id', 'campaignId', 'channel', 'addressSnapshot', 'failureReason', 'attempts', 'updatedAt'],
    });
    const failedSteps = await CrmWorkflowStepExecutions.findAll({
      where: { status: 'failed' },
      order: [['id', 'DESC']],
      limit: 20,
      attributes: ['id', 'enrollmentId', 'nodeId', 'nodeType', 'errorMessage', 'attempt', 'completedAt'],
    });

    const quotas = await Promise.all(
      (['email', 'whatsapp', 'sms'] as const).map(async (channel) => ({ channel, ...(await checkDailyQuota(channel)) }))
    );

    return NextResponse.json({
      success: true,
      campaignsByStatus,
      recipientsByStatus,
      enrollmentsByStatus,
      stepsByStatus,
      failedRecipients,
      failedSteps,
      quotas,
    });
  } catch (error) {
    console.error('Failed to load broadcast analytics:', error);
    return NextResponse.json({ success: false, error: 'Failed to load broadcast analytics' }, { status: 500 });
  }
}
