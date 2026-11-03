import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/sequelize', () => ({ sequelize: { query: vi.fn() } }));
vi.mock('@/lib/mailer', () => ({ sendEmail: vi.fn() }));
vi.mock('@/lib/mailboxes', () => ({ getMailboxForEmployee: vi.fn(), sendFromMailbox: vi.fn() }));

import { shouldNotifyTransfer } from '@/lib/leadTransferNotices';
import { buildLeadTransferEmail } from '@/lib/leadTransferEmail';

describe('shouldNotifyTransfer', () => {
  it('emails when a person transfers a lead to someone', () => {
    expect(shouldNotifyTransfer({ oldAssignTo: 5, newAssignTo: 9, actorId: 1 })).toBe(true);
    expect(shouldNotifyTransfer({ oldAssignTo: null, newAssignTo: 9, actorId: 1 })).toBe(true); // manager assigns an unassigned lead
  });
  it('emails for automatic reassignment of an owned lead (inactivity / SLA sweep)', () => {
    expect(shouldNotifyTransfer({ oldAssignTo: 5, newAssignTo: 9, actorId: null })).toBe(true);
  });
  it('does not email for unassignment, no-ops, self-assignment, or new system-created leads', () => {
    expect(shouldNotifyTransfer({ oldAssignTo: 5, newAssignTo: null, actorId: 1 })).toBe(false);
    expect(shouldNotifyTransfer({ oldAssignTo: 9, newAssignTo: 9, actorId: 1 })).toBe(false);
    expect(shouldNotifyTransfer({ oldAssignTo: 5, newAssignTo: 9, actorId: 9 })).toBe(false);
    expect(shouldNotifyTransfer({ oldAssignTo: null, newAssignTo: 9, actorId: null })).toBe(false);
  });
});

const lead = (id: number, name: string) => ({
  id, name, phone: '+971500000000', email: 'x@y.co', nationality: 'IN', branch: 'Dubai', serviceInterest: 'PR', countryInterest: 'Canada',
  marketSource: 'Meta', campaign: 'Norway-Uae', priority: 'Medium', status: 'New', leadQuality: 'Warm', enquiry: '', notes: '', followUp: '', created: '2026-11-04 10:00',
});

describe('buildLeadTransferEmail', () => {
  it('one lead: full-detail email naming the lead', () => {
    const { subject, html } = buildLeadTransferEmail({ counselorName: 'Asha', actorName: 'Ravi', actorRole: 'Manager', leads: [lead(7, 'Sam Doe')], totalLeads: 1, appUrl: 'https://crm.example.com' });
    expect(subject).toBe('Lead assigned to you: Sam Doe (#7)');
    expect(html).toContain('Open lead in CRM');
    expect(html).toContain('https://crm.example.com/admin/leads/7/edit');
  });
  it('several leads: ONE email listing all of them', () => {
    const { subject, html } = buildLeadTransferEmail({ counselorName: 'Asha', actorName: 'Ravi', actorRole: 'Manager', leads: [lead(7, 'A'), lead(8, 'B'), lead(9, 'C')], totalLeads: 3, appUrl: 'https://crm.example.com' });
    expect(subject).toBe('3 leads assigned to you');
    expect(html.match(/<tr><td><a href/g)?.length).toBe(3);
  });
  it('escapes lead fields so a hostile form entry cannot inject markup', () => {
    const { html } = buildLeadTransferEmail({ counselorName: 'Asha', actorName: 'Ravi', actorRole: 'Manager', leads: [lead(7, '<script>alert(1)</script>')], totalLeads: 1, appUrl: '' });
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });
});
