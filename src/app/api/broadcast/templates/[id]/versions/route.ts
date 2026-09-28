import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { connectDB } from '@/lib/sequelize';
import { CrmMessageTemplates, CrmMessageTemplateVersions } from '@/models';
import { canAccessBranchScopedRecord } from '@/lib/roleChecks';
import { componentsSchemaForChannel, templateVariableSchemaArray } from '@/lib/broadcastTemplateSchemas';
import { templateVersionContentHash } from '@/lib/broadcastTemplateHash';

const TEMPLATE_PERMISSION = ['templates.manage'];

let dbReady = false;
const ensureDb = async () => {
  if (!dbReady) {
    await connectDB();
    dbReady = true;
  }
};

// Creates a new draft version. A version is never edited or replaced in
// place once created - see crm_message_template_versions.is_published in
// migrations/20261001_broadcast_automation_schema.sql: once a version is
// published, a crm_broadcast_campaigns row may already point at it, so its
// content must stay exactly what was reviewed/approved/sent. Every edit
// after that point creates version N+1 instead.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = requireAuth(request, TEMPLATE_PERMISSION);
  if (isAuthError(auth)) return auth;
  try {
    await ensureDb();
    const { id } = await params;
    const template = await CrmMessageTemplates.findOne({ where: { id: Number.parseInt(id, 10), isDeleted: false } });
    if (!template) return NextResponse.json({ success: false, error: 'Template not found' }, { status: 404 });
    if (!canAccessBranchScopedRecord(auth, template)) return NextResponse.json({ success: false, error: 'Template not found' }, { status: 404 });

    const body = await request.json();
    const componentsResult = componentsSchemaForChannel(template.channel).safeParse(body.components);
    if (!componentsResult.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid components for this channel', details: componentsResult.error.flatten() },
        { status: 400 }
      );
    }

    let variableSchema: unknown = null;
    if (body.variableSchema !== undefined) {
      const variablesResult = templateVariableSchemaArray.safeParse(body.variableSchema);
      if (!variablesResult.success) {
        return NextResponse.json(
          { success: false, error: 'Invalid variableSchema', details: variablesResult.error.flatten() },
          { status: 400 }
        );
      }
      variableSchema = variablesResult.data;
    }

    const latest = await CrmMessageTemplateVersions.findOne({
      where: { templateId: template.id },
      order: [['versionNumber', 'DESC']],
    });
    const nextVersionNumber = (latest?.versionNumber ?? 0) + 1;

    const version = await CrmMessageTemplateVersions.create({
      templateId: template.id,
      versionNumber: nextVersionNumber,
      channel: template.channel,
      components: componentsResult.data,
      designJson: template.channel === 'email' ? (body.designJson ?? null) : null,
      exportHtml: template.channel === 'email' ? (body.exportHtml ?? null) : null,
      exportText: body.exportText ?? null,
      variableSchema,
      sampleValues: body.sampleValues ?? null,
      contentHash: templateVersionContentHash(componentsResult.data, body.designJson),
      createdBy: auth.id,
    });

    await template.update({ currentDraftVersionId: version.id });

    return NextResponse.json({ success: true, version }, { status: 201 });
  } catch (error) {
    console.error('Failed to create template version:', error);
    return NextResponse.json({ success: false, error: 'Failed to create template version' }, { status: 500 });
  }
}
