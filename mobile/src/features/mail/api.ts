import { api, toPage, type Page, type RawPagination } from '@/services/api/client';
import { uploadFiles, type PickedFile } from '@/services/api/upload';
import type { MailAction, MailCounts, MailFolder, MailMessage, MailRow, MailboxSummary } from './types';

// The mailbox lives on the server (SMTP/IMAP credentials never reach the phone);
// the app only talks to the same /api/mail endpoints the web module uses. Every
// call is scoped to the signed-in user's own mailbox server-side.

const REQUIRES = ['leads.view'];

export interface MailListResult {
  page: Page<MailRow>;
  mailbox: MailboxSummary | null;
  counts: MailCounts;
}

export async function fetchMail(folder: MailFolder, page: number, search: string, unreadOnly: boolean, limit = 25): Promise<MailListResult> {
  const response = await api.get<{
    mailbox: MailboxSummary | null;
    counts?: MailCounts;
    data: MailRow[];
    pagination?: RawPagination;
  }>('/api/mail/messages', {
    query: { folder, page, limit, q: search.trim() || undefined, unread: unreadOnly ? 1 : undefined },
    requires: REQUIRES,
  });
  return {
    page: toPage(response.data, response.pagination, page),
    mailbox: response.mailbox,
    counts: response.counts ?? { inbox_unread: 0, starred: 0, trash: 0, archive: 0 },
  };
}

export async function fetchThread(id: number): Promise<MailMessage[]> {
  const response = await api.get<{ data: MailMessage[] }>(`/api/mail/messages/${id}`, { requires: REQUIRES });
  return response.data ?? [];
}

export function mailAction(ids: number[], action: MailAction): Promise<unknown> {
  return api.patch('/api/mail/messages', { ids, action }, { requires: REQUIRES });
}

export function syncMail(): Promise<{ fetched: number }> {
  return api.post<{ fetched: number }>('/api/mail/sync', {}, { requires: REQUIRES, timeoutMs: 60_000 });
}

export interface SendMailInput {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  inReplyTo?: string | null;
  leadId?: number | null;
  files: PickedFile[];
}

export function sendMail(input: SendMailInput): Promise<{ messageId?: string }> {
  const fields: Record<string, string> = { to: input.to, subject: input.subject, body: input.body };
  if (input.cc) fields.cc = input.cc;
  if (input.bcc) fields.bcc = input.bcc;
  if (input.inReplyTo) fields.inReplyTo = input.inReplyTo;
  if (input.leadId) fields.leadId = String(input.leadId);
  return uploadFiles<{ messageId?: string }>('/api/mail/send', input.files, fields, 'files');
}
