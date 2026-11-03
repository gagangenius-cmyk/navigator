import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, isAuthError } from '@/lib/apiAuth';
import { connectDB } from '@/lib/sequelize';
import { resolveUsableTemplates } from '@/lib/messageTemplateScope';
import { purposeForCategory } from '@/lib/broadcastPurpose';
import { canSendAsOwner } from '@/lib/templateSend/recipients';

let dbReady = false;
const ensureDb = async () => { if (!dbReady) { await connectDB(); dbReady = true; } };

/** GET /api/template-sends/templates - email templates this employee can send from the Leads page. */
export async function GET(request: NextRequest) {
  const auth = requireAuth(request, ['templates.use']);
  if (isAuthError(auth)) return auth;
  try {
    await ensureDb();
    const usable = await resolveUsableTemplates({ id: auth.id, branch: auth.branch, role: auth.role }, { channel: 'email' });
    const templates = usable
      .filter((t) => purposeForCategory(t.category) === 'transactional')
      .map((t) => ({ id: t.id, name: t.name, category: t.category, folder: t.folder }));
    const canInstallStarters = templates.length === 0 && Boolean(auth.permissions?.includes('all') || auth.permissions?.includes('templates.manage'));
    return NextResponse.json({ success: true, templates, canSendAsOwner: canSendAsOwner(auth), canInstallStarters });
  } catch (error) {
    console.error('Failed to list sendable templates:', error);
    return NextResponse.json({ success: false, error: 'Failed to load templates' }, { status: 500 });
  }
}
