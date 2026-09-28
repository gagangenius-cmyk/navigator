import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { connectDB } from '@/lib/sequelize';
import { CrmMessageTemplates, CrmMessageTemplateVersions } from '@/models';
import type { EmailTemplateComponents, SmsTemplateComponents, WhatsappTemplateComponents } from '@/lib/broadcastTemplateSchemas';
import { MissingTemplateVariablesError, estimateSmsSegments, renderTemplateText } from '@/lib/broadcastTemplateRender';
import { canAccessBranchScopedRecord } from '@/lib/roleChecks';

const TEMPLATE_PERMISSION = ['templates.manage'];

let dbReady = false;
const ensureDb = async () => {
  if (!dbReady) {
    await connectDB();
    dbReady = true;
  }
};

// Renders a version's text fields with the given (or sample) variable
// values. Text-only: this does not render Unlayer's export_html - that's a
// client-side/email-client rendering concern, not something to reproduce
// server-side. WhatsApp media headers are returned as-is (format + no text
// to substitute); this route only ever substitutes {{name}} tokens in text.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(request, TEMPLATE_PERMISSION);
  if (isAuthError(auth)) return auth;
  try {
    await ensureDb();
    const { id } = await params;
    const template = await CrmMessageTemplates.findOne({ where: { id: Number.parseInt(id, 10), isDeleted: false } });
    if (!template) return NextResponse.json({ success: false, error: 'Template not found' }, { status: 404 });
    if (!canAccessBranchScopedRecord(auth, template)) return NextResponse.json({ success: false, error: 'Template not found' }, { status: 404 });

    const body = await request.json().catch(() => ({}));
    const versionId = body.versionId ?? template.currentPublishedVersionId ?? template.currentDraftVersionId;
    if (!versionId) return NextResponse.json({ success: false, error: 'Template has no version to preview' }, { status: 400 });

    const version = await CrmMessageTemplateVersions.findOne({ where: { id: versionId, templateId: template.id } });
    if (!version) return NextResponse.json({ success: false, error: 'Version not found' }, { status: 404 });

    const sampleValues = (version.sampleValues as Record<string, string> | null) ?? {};
    const values: Record<string, string> = { ...sampleValues, ...(body.variables ?? {}) };

    try {
      if (template.channel === 'whatsapp') {
        const components = version.components as WhatsappTemplateComponents;
        const rendered = {
          header: components.header?.format === 'TEXT' && components.header.text
            ? { ...components.header, text: renderTemplateText(components.header.text, values) }
            : components.header ?? null,
          body: { text: renderTemplateText(components.body.text, values) },
          footer: components.footer ? { text: renderTemplateText(components.footer.text, values) } : null,
          buttons: (components.buttons ?? []).map((button) => (
            button.type === 'URL' ? { ...button, url: renderTemplateText(button.url, values) } : button
          )),
        };
        return NextResponse.json({ success: true, channel: 'whatsapp', rendered });
      }

      if (template.channel === 'email') {
        const components = version.components as EmailTemplateComponents;
        const rendered = {
          subject: renderTemplateText(components.subject, values),
          preheader: components.preheader ? renderTemplateText(components.preheader, values) : null,
        };
        return NextResponse.json({ success: true, channel: 'email', rendered });
      }

      const components = version.components as SmsTemplateComponents;
      const text = renderTemplateText(components.text, values);
      return NextResponse.json({ success: true, channel: 'sms', rendered: { text }, segmentEstimate: estimateSmsSegments(text) });
    } catch (error) {
      if (error instanceof MissingTemplateVariablesError) {
        return NextResponse.json({ success: false, error: error.message, missing: error.missing }, { status: 400 });
      }
      throw error;
    }
  } catch (error) {
    console.error('Failed to render template preview:', error);
    return NextResponse.json({ success: false, error: 'Failed to render template preview' }, { status: 500 });
  }
}
