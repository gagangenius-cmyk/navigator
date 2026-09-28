import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { connectDB } from '@/lib/sequelize';
import { CrmMessageTemplates, CrmMessageTemplateVersions } from '@/models';
import { canAccessBranchScopedRecord } from '@/lib/roleChecks';

const TEMPLATE_PERMISSION = ['templates.manage'];

let dbReady = false;
const ensureDb = async () => {
  if (!dbReady) {
    await connectDB();
    dbReady = true;
  }
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(request, TEMPLATE_PERMISSION);
  if (isAuthError(auth)) return auth;
  try {
    await ensureDb();
    const { id } = await params;
    const template = await CrmMessageTemplates.findOne({ where: { id: Number.parseInt(id, 10), isDeleted: false } });
    if (!template) return NextResponse.json({ success: false, error: 'Template not found' }, { status: 404 });
    if (!canAccessBranchScopedRecord(auth, template)) return NextResponse.json({ success: false, error: 'Template not found' }, { status: 404 });

    const versions = await CrmMessageTemplateVersions.findAll({
      where: { templateId: template.id },
      order: [['versionNumber', 'DESC']],
    });

    return NextResponse.json({ success: true, template, versions });
  } catch (error) {
    console.error('Failed to fetch message template:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch message template' }, { status: 500 });
  }
}

// Metadata-only update - a version's content (components/design) is never
// edited in place, only superseded by POST .../versions (see that route's
// header comment for why: published versions must stay immutable for
// campaigns that already reference them).
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(request, TEMPLATE_PERMISSION);
  if (isAuthError(auth)) return auth;
  try {
    await ensureDb();
    const { id } = await params;
    const template = await CrmMessageTemplates.findOne({ where: { id: Number.parseInt(id, 10), isDeleted: false } });
    if (!template) return NextResponse.json({ success: false, error: 'Template not found' }, { status: 404 });
    if (!canAccessBranchScopedRecord(auth, template)) return NextResponse.json({ success: false, error: 'Template not found' }, { status: 404 });

    const body = await request.json();
    const updates: Partial<{ name: string; category: string | null; language: string; folder: string | null; tags: string[] | null }> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.category !== undefined) updates.category = body.category;
    if (body.language !== undefined) updates.language = body.language;
    if (body.folder !== undefined) updates.folder = body.folder;
    if (body.tags !== undefined) updates.tags = body.tags;

    await template.update(updates);
    return NextResponse.json({ success: true, template });
  } catch (error) {
    console.error('Failed to update message template:', error);
    return NextResponse.json({ success: false, error: 'Failed to update message template' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(request, TEMPLATE_PERMISSION);
  if (isAuthError(auth)) return auth;
  try {
    await ensureDb();
    const { id } = await params;
    const template = await CrmMessageTemplates.findOne({ where: { id: Number.parseInt(id, 10), isDeleted: false } });
    if (!template) return NextResponse.json({ success: false, error: 'Template not found' }, { status: 404 });
    if (!canAccessBranchScopedRecord(auth, template)) return NextResponse.json({ success: false, error: 'Template not found' }, { status: 404 });

    // Soft delete only - crm_broadcast_campaigns.template_version_id is
    // ON DELETE RESTRICT (see migrations/20261001_broadcast_automation_schema.sql),
    // so a template a campaign has ever used can never be hard-deleted anyway.
    await template.update({ isDeleted: true, deletedAt: new Date() });
    return NextResponse.json({ success: true, message: 'Template deleted successfully' });
  } catch (error) {
    console.error('Failed to delete message template:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete message template' }, { status: 500 });
  }
}
