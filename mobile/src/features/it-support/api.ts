import { api } from '@/services/api/client';

export const IT_CATEGORIES = [
  'Laptop / Desktop Hardware',
  'Access & Accounts',
  'New Procurement',
  'Network & Internet',
  'Email & Communication',
  'Software & Licensing',
] as const;
export type ItCategory = (typeof IT_CATEGORIES)[number];

export const IT_PRIORITIES = ['High', 'Medium', 'Low'] as const;
export type ItPriority = (typeof IT_PRIORITIES)[number];

export interface ItTicket {
  id: string;
  ticket_number: string | null;
  title: string;
  description: string | null;
  category: ItCategory;
  priority: ItPriority;
  estimated_cost_aed: string | number | null;
  status: 'Open' | 'Resolved' | 'Closed' | 'Rejected';
  workflow_status: string;
  raised_by_name: string | null;
  branch_name: string | null;
  assigned_to_name: string | null;
  due_at: string | null;
  created_at: string;
}

export async function fetchMyTickets(): Promise<ItTicket[]> {
  const response = await api.get<{ tickets: ItTicket[] }>('/api/admin/it-support/tickets', {
    query: { mine: 1, limit: 100 },
    requires: ['it.self'],
  });
  return response.tickets ?? [];
}

export interface CreateTicketInput {
  title: string;
  description?: string;
  category: ItCategory;
  priority: ItPriority;
  estimatedCostAed?: number;
}

export function createTicket(input: CreateTicketInput, branchId: number): Promise<unknown> {
  return api.post(
    '/api/admin/it-support/tickets',
    {
      title: input.title.trim(),
      description: input.description?.trim() || null,
      category: input.category,
      priority: input.priority,
      estimated_cost_aed: input.estimatedCostAed ?? null,
      branch_id: branchId || null,
    },
    { requires: ['it.create', 'it.self'] },
  );
}
