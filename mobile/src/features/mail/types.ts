export type MailFolder = 'inbox' | 'starred' | 'sent' | 'archive' | 'trash';

export interface MailRow {
  id: number;
  direction: 'in' | 'out';
  folder: string;
  from_address: string | null;
  from_name: string | null;
  to_addresses: string | null;
  subject: string | null;
  preview: string;
  lead_id: number | null;
  lead_name: string | null;
  is_read: number;
  is_starred: number;
  has_attachments: number;
  status: string;
  message_date: string;
  thread_count: number;
}

export interface MailAttachment {
  id: number;
  filename: string;
  size: number;
  content_type: string | null;
}

export interface MailMessage {
  id: number;
  direction: 'in' | 'out';
  folder: string;
  message_id: string | null;
  from_address: string | null;
  from_name: string | null;
  to_addresses: string | null;
  cc_addresses: string | null;
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  lead_id: number | null;
  lead_name: string | null;
  is_starred: number;
  status: string;
  error: string | null;
  message_date: string;
  attachments: MailAttachment[];
}

export interface MailboxSummary {
  id: number;
  email: string;
  imap_host: string | null;
  last_error: string | null;
}

export interface MailCounts {
  inbox_unread: number;
  starred: number;
  trash: number;
  archive: number;
}

export type MailAction = 'read' | 'unread' | 'star' | 'unstar' | 'archive' | 'trash' | 'restore' | 'purge';

export interface ComposeDraft {
  to?: string;
  cc?: string;
  subject?: string;
  body?: string;
  inReplyTo?: string | null;
  leadId?: number | null;
}
