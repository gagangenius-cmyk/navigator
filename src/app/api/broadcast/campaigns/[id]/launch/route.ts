import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { connectDB, sequelize } from '@/lib/sequelize';
import {
  CrmBroadcastCampaigns,
  CrmBroadcastRecipients,
  CrmMessageTemplateVersions,
  CrmMessageTemplates,
  CrmContactSegments,
  CrmcForumLeads,
  CrmContactChannelConsents,
  CrmMessageSuppressions,
  CrmAutomationAuditLogs,
} from '@/models';
import type { CrmBroadcastRecipientsCreationAttributes } from '@/models/CrmBroadcastRecipients';
import { segmentAstToSequelizeWhere, type SegmentGroupNode } from '@/lib/broadcastSegmentAst';
import { canAccessBranchScopedRecord, canAccessSegment } from '@/lib/roleChecks';
import { checkTemplateApprovedForLaunch, computePublishedConfigHash, isRecipientEligible } from '@/lib/broadcastPreflight';
import { resolveRecipientAddress, resolveVariableMapping, type VariableMapping } from '@/lib/broadcastVariableMapping';
import { recipientIdempotencyKey, suppressionAddressHash } from '@/lib/broadcastDedupeKeys';

const CAMPAIGN_PERMISSION = ['campaigns.manage'];
const RECIPIENT_INSERT_BATCH_SIZE = 500;

let dbReady = false;
const ensureDb = async () => {
  if (!dbReady) {
    await connectDB();
    dbReady = true;
  }
};

// The full campaign preflight + recipient snapshot
// (docs/broadcast-architecture.md section 6). Every check in here runs
// once, at launch time, and the result (segment_snapshot,
// published_config_hash, the recipient rows themselves) is then frozen -
// nothing here re-runs per-send; the worker (src/lib/broadcastWorker.ts)
// re-checks only cancellation/suppression/consent immediately before each
// individual send, per the spec's "recheck ... immediately before sending"
// rule, which this route cannot itself guarantee still holds by the time a
// scheduled campaign's send actually happens.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(request, CAMPAIGN_PERMISSION);
  if (isAuthError(auth)) return auth;
  try {
    await ensureDb();
    const { id } = await params;
    const campaign = await CrmBroadcastCampaigns.findOne({ where: { id: Number.parseInt(id, 10), isDeleted: false } });
    if (!campaign) return NextResponse.json({ success: false, error: 'Campaign not found' }, { status: 404 });
    if (!canAccessBranchScopedRecord(auth, campaign)) return NextResponse.json({ success: false, error: 'Campaign not found' }, { status: 404 });
    if (campaign.status !== 'draft') {
      return NextResponse.json({ success: false, error: `Campaign cannot be launched from status "${campaign.status}"` }, { status: 409 });
    }

    const version = await CrmMessageTemplateVersions.findByPk(campaign.templateVersionId);
    const template = version ? await CrmMessageTemplates.findByPk(version.templateId) : null;
    if (!version || !template) {
      return NextResponse.json({ success: false, error: 'Campaign template is missing' }, { status: 400 });
    }

    const approval = checkTemplateApprovedForLaunch({
      channel: template.channel,
      status: template.status,
      providerTemplateId: template.providerTemplateId,
      currentPublishedVersionId: template.currentPublishedVersionId,
    });
    if (!approval.approved) {
      return NextResponse.json({ success: false, error: 'Template failed the launch preflight', reason: approval.reason }, { status: 422 });
    }

    if (!campaign.segmentId) {
      return NextResponse.json({ success: false, error: 'Campaign has no segment - select an audience before launching' }, { status: 400 });
    }
    const segment = await CrmContactSegments.findByPk(campaign.segmentId);
    if (!segment) return NextResponse.json({ success: false, error: 'Segment not found' }, { status: 404 });
    if (!canAccessSegment(auth, segment)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });

    // filterAst was validated by segmentFilterAstSchema when the segment was
    // created/updated (src/app/api/broadcast/segments/route.ts) - this cast
    // trusts that invariant rather than re-validating on every launch.
    const leads = await CrmcForumLeads.findAll({
      where: segmentAstToSequelizeWhere(segment.filterAst as SegmentGroupNode),
      attributes: ['id', 'fname', 'lname', 'email', 'mobile', 'whatsapp_number'],
    });

    const isScheduledForLater = Boolean(campaign.scheduledAtUtc && campaign.scheduledAtUtc.getTime() > Date.now());
    const initialRecipientStatus: 'pending' | 'queued' = isScheduledForLater ? 'pending' : 'queued';
    const mapping = (campaign.variableMapping as VariableMapping | null) ?? {};

    let eligibleCount = 0;
    let skippedNoAddress = 0;
    let skippedSuppressed = 0;
    let skippedNoConsent = 0;
    const recipientRows: CrmBroadcastRecipientsCreationAttributes[] = [];

    for (const lead of leads) {
      const address = resolveRecipientAddress(lead, template.channel);
      if (!address) {
        skippedNoAddress += 1;
        continue;
      }

      const addressHash = suppressionAddressHash(address);
      const [isSuppressed, consent] = await Promise.all([
        CrmMessageSuppressions.findOne({ where: { channel: template.channel, addressHash } }),
        CrmContactChannelConsents.findOne({ where: { leadId: lead.id, channel: template.channel, purpose: 'marketing' } }),
      ]);

      const eligibility = isRecipientEligible({
        purpose: 'marketing',
        consentState: consent?.consentState ?? 'unknown',
        isSuppressed: Boolean(isSuppressed),
      });

      if (!eligibility.eligible) {
        if (eligibility.reason === 'suppressed') skippedSuppressed += 1;
        else skippedNoConsent += 1;
        continue;
      }

      eligibleCount += 1;
      recipientRows.push({
        campaignId: campaign.id,
        leadId: lead.id,
        channel: template.channel,
        addressSnapshot: address,
        templateVersionId: version.id,
        renderedVariables: resolveVariableMapping(mapping, lead),
        status: initialRecipientStatus,
        idempotencyKey: recipientIdempotencyKey(campaign.id, lead.id, template.channel),
      });
    }

    const configHash = computePublishedConfigHash({
      templateVersionId: version.id,
      segmentId: segment.id,
      variableMapping: mapping,
      scheduledAtUtc: campaign.scheduledAtUtc ? campaign.scheduledAtUtc.toISOString() : null,
    });

    // Recipient rows + the campaign's own launch-state flip + the audit log
    // entry all happen in one transaction - a launch must never leave a
    // campaign marked 'running'/'scheduled' with only some of its
    // recipients actually snapshotted (or vice versa: recipients inserted
    // but the campaign still 'draft'), per the spec's "write outbox rows
    // transactionally" rule.
    const insertedIds: number[] = [];
    await sequelize.transaction(async (transaction) => {
      for (let offset = 0; offset < recipientRows.length; offset += RECIPIENT_INSERT_BATCH_SIZE) {
        const batch = recipientRows.slice(offset, offset + RECIPIENT_INSERT_BATCH_SIZE);
        const created = await CrmBroadcastRecipients.bulkCreate(batch, { ignoreDuplicates: true, transaction });
        insertedIds.push(...created.map((row) => row.id));
      }

      await campaign.update({
        segmentSnapshot: { filterAst: segment.filterAst, estimatedAt: new Date().toISOString(), eligibleCount },
        publishedConfigHash: configHash,
        totalRecipients: eligibleCount,
        status: isScheduledForLater ? 'scheduled' : 'running',
        launchedAt: isScheduledForLater ? null : new Date(),
      }, { transaction });

      await CrmAutomationAuditLogs.create({
        actorId: auth.id,
        action: 'campaign.launched',
        branchId: campaign.branchId,
        objectType: 'broadcast_campaign',
        objectId: campaign.id,
        metadata: { eligibleCount, skippedNoAddress, skippedSuppressed, skippedNoConsent, scheduled: isScheduledForLater },
      }, { transaction });
    });

    // Enqueued only after the transaction commits (never inside it) - a
    // BullMQ job firing before the DB row is durably committed could have
    // the worker claim a recipient that a rollback then makes disappear.
    // Scheduled campaigns are NOT enqueued here; activateDueScheduledCampaigns()
    // (src/lib/broadcastWorker.ts) enqueues them at scheduled_at_utc instead.
    if (!isScheduledForLater && insertedIds.length > 0) {
      const { enqueueBroadcastRecipient } = await import('@/lib/queues/broadcastQueue');
      await Promise.all(insertedIds.map((id) => enqueueBroadcastRecipient(id)));
    }

    return NextResponse.json({
      success: true,
      campaign,
      summary: { eligibleCount, skippedNoAddress, skippedSuppressed, skippedNoConsent },
    });
  } catch (error) {
    console.error('Failed to launch broadcast campaign:', error);
    return NextResponse.json({ success: false, error: 'Failed to launch broadcast campaign' }, { status: 500 });
  }
}
