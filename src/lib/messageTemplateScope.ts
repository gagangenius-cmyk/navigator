import { Op, type WhereOptions } from 'sequelize';
import { CrmMessageTemplates } from '@/models';
import type { CrmMessageTemplatesAttributes } from '@/models/CrmMessageTemplates';
import { ensureTemplateScopeColumns } from '@/lib/ensureTemplateScopeColumns';

// Resolution for "templates this employee can use": company-wide templates,
// plus their branch's, plus their role's. A branch/role template created as an
// override (base_template_id) hides the company template it overrides, so a new
// employee automatically gets the most specific version with no per-user setup.
export interface TemplateViewer {
  id: number;
  branch?: number | null;
  role?: number | null;
}

export async function resolveUsableTemplates(
  viewer: TemplateViewer,
  filters: { channel?: string; search?: string } = {}
) {
  await ensureTemplateScopeColumns();

  const scopeOr: Record<string, unknown>[] = [{ scopeLevel: 'company' }];
  if (viewer.branch != null) scopeOr.push({ scopeLevel: 'branch', branchId: viewer.branch });
  if (viewer.role != null) {
    scopeOr.push({
      scopeLevel: 'role',
      roleId: viewer.role,
      branchId: viewer.branch != null ? { [Op.or]: [viewer.branch, null] } : null,
    });
  }

  const and: WhereOptions<CrmMessageTemplatesAttributes>[] = [
    { isDeleted: false },
    { status: 'approved' },
    { currentPublishedVersionId: { [Op.ne]: null } },
    { [Op.or]: scopeOr },
  ];
  if (filters.channel) and.push({ channel: filters.channel });
  if (filters.search) and.push({ name: { [Op.like]: `%${filters.search}%` } });

  const templates = await CrmMessageTemplates.findAll({ where: { [Op.and]: and }, order: [['name', 'ASC']] });

  const overridden = new Set<number>();
  for (const t of templates) {
    if (t.baseTemplateId != null && t.scopeLevel !== 'company') overridden.add(t.baseTemplateId);
  }
  return templates.filter((t) => !overridden.has(t.id));
}

// May this viewer use one specific template (render it for a lead)?
export async function canUseTemplate(viewer: TemplateViewer, templateId: number) {
  const usable = await resolveUsableTemplates(viewer);
  return usable.find((t) => t.id === templateId) ?? null;
}

// Which scope a creator may author at. Company scope is CEO/all-branch roles
// only; everyone else with templates.manage is confined to their own branch.
export function allowedScopeForCreator(
  canAll: boolean,
  requested: string | undefined,
  user: { branch?: number | null }
): { ok: true; scopeLevel: 'company' | 'branch' | 'role'; branchId: number | null } | { ok: false; error: string } {
  const scopeLevel = (requested === 'branch' || requested === 'role' ? requested : 'company') as 'company' | 'branch' | 'role';
  if (scopeLevel === 'company') {
    if (!canAll) return { ok: false, error: 'Only CEO/all-branch roles can create company-wide templates' };
    return { ok: true, scopeLevel, branchId: null };
  }
  if (user.branch == null && !canAll) return { ok: false, error: 'Your account has no branch to scope this template to' };
  return { ok: true, scopeLevel, branchId: scopeLevel === 'branch' || !canAll ? (user.branch ?? null) : null };
}
