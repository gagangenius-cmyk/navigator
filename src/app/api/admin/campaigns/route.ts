import { CrmCampaigns } from '@/models/CrmCampaigns';
import { createCrudHandlers } from '@/lib/apiCrud';

const handlers = createCrudHandlers({
  model: CrmCampaigns,
  entityName: 'campaign',
  searchFields: ['campaign'],
  filters: { status: 'status' },
  requiredPermissions: ['campaigns.manage'],
  defaults: (body, auth) => ({
    created: body.created || new Date(),
    created_by: auth.id,
  }),
});

export const GET = handlers.GET;
export const POST = handlers.POST;
export const PUT = handlers.PUT;
export const DELETE = handlers.DELETE;
