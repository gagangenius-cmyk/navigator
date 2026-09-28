import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { connectDB } from '@/lib/sequelize';
import { CrmMessageTemplates, CrmMessageTemplateVersions, CrmAutomationAuditLogs } from '@/models';
import { canAccessBranchScopedRecord } from '@/lib/roleChecks';

const TEMPLATE_PERMISSION = ['templates.manage'];

let dbReady = false;
const ensureDb = async () => {
  if (!dbReady) {
    await connectDB();
    dbReady = true;
  }
};

// Publishing freezes a version as immutable (never UPDATEd again - see the
// header comment on POST .../versions) and makes it the template's "current
// published" pointer that new campaigns will use.
//
// For WhatsApp specifically this endpoint does NOT mark the template
// 'approved' - it only sets it to 'pending_review'. Real Meta approval
// requires submitting the template to a WhatsApp Business Account via the
// Graph API and waiting for/receiving a status webhook
// (crm_message_template_status_events - see
// docs/broadcast-architecture.md's Phase 2 progress note). That submission
// integration is not built yet (no WABA credentials available in this
// environment to build and test it against), so this endpoint deliberately
// stops short of claiming an approval it cannot actually obtain - per this
// feature's own compliance rule: "Never let an unapproved WhatsApp template
// launch a business-initiated campaign."
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  const auth = requireAuth(request, TEMPLATE_PERMISSION);
  if (isAuthError(auth)) return auth;
  try {
    await ensureDb();
    const { id, versionId } = await params;
    const templateId = Number.parseInt(id, 10);

    const template = await CrmMessageTemplates.findOne({ where: { id: templateId, isDeleted: false } });
    if (!template) return NextResponse.json({ success: false, error: 'Template not found' }, { status: 404 });
    if (!canAccessBranchScopedRecord(auth, template)) return NextResponse.json({ success: false, error: 'Template not found' }, { status: 404 });

    const version = await CrmMessageTemplateVersions.findOne({
      where: { id: Number.parseInt(versionId, 10), templateId },
    });
    if (!version) return NextResponse.json({ success: false, error: 'Version not found' }, { status: 404 });
    if (version.isPublished) {
      return NextResponse.json({ success: false, error: 'This version is already published' }, { status: 409 });
    }

    await version.update({ isPublished: true, publishedAt: new Date() });

    const nextStatus = template.channel === 'whatsapp' ? 'pending_review' : 'approved';
    await template.update({ currentPublishedVersionId: version.id, status: nextStatus });

    await CrmAutomationAuditLogs.create({
      actorId: auth.id,
      action: 'template.published',
      branchId: template.branchId,
      objectType: 'message_template',
      objectId: template.id,
      metadata: { versionId: version.id, versionNumber: version.versionNumber, channel: template.channel, nextStatus },
    });

    return NextResponse.json({ success: true, template, version });
  } catch (error) {
    console.error('Failed to publish template version:', error);
    return NextResponse.json({ success: false, error: 'Failed to publish template version' }, { status: 500 });
  }
}
