import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { connectDB } from '@/lib/sequelize';
import { CrmMessageTemplateVersions } from '@/models';
import { assertLeadAccess } from '@/lib/leadAccess';
import { canUseTemplate } from '@/lib/messageTemplateScope';
import { buildLeadRenderValues } from '@/lib/templateRenderContext';
import { extractVariableTokens } from '@/lib/broadcastTemplateRender';

let dbReady = false;
const ensureDb = async () => {
  if (!dbReady) {
    await connectDB();
    dbReady = true;
  }
};

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (ch) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string
));

// Renders a shared template for ONE lead on behalf of the logged-in employee
// ({{lead.*}}, {{employee.*}}, {{branch.*}}, {{company.*}}). Unlike the
// broadcast preview/launch path this is lenient: unresolved tokens come back
// blank plus a `missing` list so the employee can fix them before sending.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(request, ['templates.use']);
  if (isAuthError(auth)) return auth;
  try {
    await ensureDb();
    const { id } = await params;
    const leadId = Number(id);
    if (!leadId) return NextResponse.json({ success: false, error: 'Invalid lead id' }, { status: 400 });

    const accessError = await assertLeadAccess(auth, leadId);
    if (accessError) return accessError;

    const body = await request.json().catch(() => ({}));
    const templateId = Number(body.templateId);
    if (!templateId) return NextResponse.json({ success: false, error: 'templateId is required' }, { status: 400 });

    const template = await canUseTemplate({ id: auth.id, branch: auth.branch, role: auth.role }, templateId);
    if (!template || !template.currentPublishedVersionId) {
      return NextResponse.json({ success: false, error: 'Template not found' }, { status: 404 });
    }
    const version = await CrmMessageTemplateVersions.findOne({
      where: { id: template.currentPublishedVersionId, templateId: template.id },
    });
    if (!version) return NextResponse.json({ success: false, error: 'Template has no published version' }, { status: 404 });

    const values = await buildLeadRenderValues(leadId, auth.id);
    const missing = new Set<string>();
    const fill = (text: string | null | undefined, html = false) => (text || '').replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_m, name: string) => {
      const value = values[name];
      if (!value) { missing.add(name); return ''; }
      return html ? escapeHtml(value) : value;
    });

    const components = version.components as any;
    let rendered: Record<string, string | null>;
    if (template.channel === 'whatsapp') {
      rendered = { text: fill(components.body?.text) };
    } else if (template.channel === 'sms') {
      rendered = { text: fill(components.text) };
    } else {
      rendered = {
        subject: fill(components.subject),
        text: version.exportText ? fill(version.exportText) : null,
        html: version.exportHtml ? fill(version.exportHtml, true) : null,
      };
    }

    return NextResponse.json({
      success: true,
      channel: template.channel,
      templateName: template.name,
      rendered,
      missing: [...missing],
      variables: extractVariableTokens(JSON.stringify(components)),
    });
  } catch (error) {
    console.error('Failed to render template for lead:', error);
    return NextResponse.json({ success: false, error: 'Failed to render template' }, { status: 500 });
  }
}
