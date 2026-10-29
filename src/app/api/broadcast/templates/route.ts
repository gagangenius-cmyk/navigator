import { NextRequest, NextResponse } from 'next/server';
import { Op } from 'sequelize';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { connectDB } from '@/lib/sequelize';
import { CrmMessageTemplates, CrmMessageTemplateVersions } from '@/models';
import { canViewAllBranches } from '@/lib/roleChecks';
import { componentsSchemaForChannel, templateVariableSchemaArray } from '@/lib/broadcastTemplateSchemas';
import { templateVersionContentHash } from '@/lib/broadcastTemplateHash';
import { ensureTemplateScopeColumns } from '@/lib/ensureTemplateScopeColumns';
import { allowedScopeForCreator, resolveUsableTemplates } from '@/lib/messageTemplateScope';

const TEMPLATE_PERMISSION = ['templates.manage'];

let dbReady = false;
const ensureDb = async () => {
  if (!dbReady) {
    await connectDB();
    dbReady = true;
  }
};

export async function GET(request: NextRequest) {
  // ?usable=1 is the picker list for any employee (templates.use): approved,
  // published templates resolved company > branch > role with overrides applied.
  const usableOnly = new URL(request.url).searchParams.get('usable') === '1';
  const auth = requireAuth(request, usableOnly ? ['templates.use', ...TEMPLATE_PERMISSION] : TEMPLATE_PERMISSION);
  if (isAuthError(auth)) return auth;
  try {
    await ensureDb();
    await ensureTemplateScopeColumns();
    const { searchParams } = new URL(request.url);
    if (usableOnly) {
      const usable = await resolveUsableTemplates(
        { id: auth.id, branch: auth.branch, role: auth.role },
        { channel: searchParams.get('channel') || undefined, search: searchParams.get('search')?.trim() || undefined }
      );
      return NextResponse.json({ success: true, templates: usable });
    }
    const channel = searchParams.get('channel');
    const status = searchParams.get('status');
    const search = searchParams.get('search')?.trim();

    const scopeWhere = canViewAllBranches(auth) ? {} : { branchId: { [Op.or]: [auth.branch ?? -1, null] } };
    const where: Record<string | symbol, unknown> = { [Op.and]: [{ isDeleted: false }, scopeWhere] };
    if (channel) (where[Op.and] as unknown[]).push({ channel });
    if (status) (where[Op.and] as unknown[]).push({ status });
    if (search) (where[Op.and] as unknown[]).push({ name: { [Op.like]: `%${search}%` } });

    const templates = await CrmMessageTemplates.findAll({ where, order: [['id', 'DESC']] });
    return NextResponse.json({ success: true, templates });
  } catch (error) {
    console.error('Failed to list message templates:', error);
    return NextResponse.json({ success: false, error: 'Failed to list message templates' }, { status: 500 });
  }
}

// Creates a template and its first draft version (version_number 1) in one
// call - a template with zero versions has no content to preview/send, so
// there is no useful intermediate state to leave it in.
export async function POST(request: NextRequest) {
  const auth = requireAuth(request, TEMPLATE_PERMISSION);
  if (isAuthError(auth)) return auth;
  try {
    await ensureDb();
    await ensureTemplateScopeColumns();
    const body = await request.json();

    if (!body.channel || !['email', 'whatsapp', 'sms'].includes(body.channel)) {
      return NextResponse.json({ success: false, error: 'channel must be one of email, whatsapp, sms' }, { status: 400 });
    }
    if (!body.name || typeof body.name !== 'string') {
      return NextResponse.json({ success: false, error: 'name is required' }, { status: 400 });
    }

    const componentsResult = componentsSchemaForChannel(body.channel).safeParse(body.components);
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

    const scope = allowedScopeForCreator(canViewAllBranches(auth), body.scopeLevel, auth);
    if (!scope.ok) return NextResponse.json({ success: false, error: scope.error }, { status: 403 });
    const roleId = scope.scopeLevel === 'role' ? Number(body.roleId) || null : null;
    if (scope.scopeLevel === 'role' && !roleId) {
      return NextResponse.json({ success: false, error: 'roleId is required for role-scoped templates' }, { status: 400 });
    }
    // The DB unique key treats NULL branch_id rows as distinct, so company-scope
    // duplicates must be rejected here.
    const duplicate = await CrmMessageTemplates.findOne({
      where: { branchId: scope.branchId, roleId, channel: body.channel, name: body.name, isDeleted: false },
    });
    if (duplicate) {
      return NextResponse.json({ success: false, error: 'A template with this name already exists in this scope' }, { status: 409 });
    }

    const template = await CrmMessageTemplates.create({
      branchId: scope.branchId,
      scopeLevel: scope.scopeLevel,
      roleId,
      baseTemplateId: body.baseTemplateId ? Number(body.baseTemplateId) : null,
      channel: body.channel,
      name: body.name,
      category: body.category ?? null,
      language: body.language ?? 'en',
      folder: body.folder ?? null,
      tags: body.tags ?? null,
      providerTemplateId: null,
      status: 'draft',
      currentDraftVersionId: null,
      currentPublishedVersionId: null,
      ownerId: auth.id,
    });

    const version = await CrmMessageTemplateVersions.create({
      templateId: template.id,
      versionNumber: 1,
      channel: body.channel,
      components: componentsResult.data,
      designJson: body.channel === 'email' ? (body.designJson ?? null) : null,
      exportHtml: body.channel === 'email' ? (body.exportHtml ?? null) : null,
      exportText: body.exportText ?? null,
      variableSchema,
      sampleValues: body.sampleValues ?? null,
      contentHash: templateVersionContentHash(componentsResult.data, body.designJson),
      createdBy: auth.id,
    });

    await template.update({ currentDraftVersionId: version.id });

    return NextResponse.json({ success: true, template, version }, { status: 201 });
  } catch (error) {
    console.error('Failed to create message template:', error);
    return NextResponse.json({ success: false, error: 'Failed to create message template' }, { status: 500 });
  }
}
