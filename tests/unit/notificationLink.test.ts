import { describe, expect, it } from 'vitest';
import { resolveNotificationLink as go } from '@/lib/notificationLink';

describe('resolveNotificationLink', () => {
  it('sends Accounts to payment verification (not the lead)', () => {
    expect(go({ type: 'payment_submission', link: '/admin/leads/503/edit', relatedType: 'lead', relatedId: 503 })).toBe('/admin/finance/payment-verification');
  });
  it('sends the counselor to the opportunity flow after verification / compliance review', () => {
    expect(go({ type: 'payment_verification', link: '/admin/leads/503/edit', relatedType: 'lead', relatedId: 503 })).toBe('/admin/leads/opportunity-flow?leadId=503');
    expect(go({ type: 'compliance_review', link: '/admin/leads/503/edit', relatedType: 'lead', relatedId: 503 })).toBe('/admin/leads/opportunity-flow?leadId=503');
  });
  it('sends reviewers to their queues', () => {
    expect(go({ type: 'compliance_submission', link: '/admin/leads/1/edit', relatedType: 'lead', relatedId: 1 })).toBe('/admin/compliance-approvals');
    expect(go({ type: 'discount_requested', link: '/admin/leads/1/edit', relatedType: 'lead', relatedId: 1 })).toBe('/admin/discount-approvals');
  });
  it('opens the lead for lead-centric notifications, from relatedId or from the link', () => {
    expect(go({ type: 'lead_assigned', relatedType: 'lead', relatedId: 7 })).toBe('/admin/leads/7/edit');
    expect(go({ type: 'followup', link: '/admin/leads/9/edit' })).toBe('/admin/leads/9/edit');
    expect(go({ type: 'discount_reviewed', link: '/admin/leads/12' })).toBe('/admin/leads/12/edit');
  });
  it('appointments open the appointments list; a lead meeting opens the lead', () => {
    expect(go({ type: 'appointment_cross_branch', link: '/admin/appointments' })).toBe('/admin/appointments');
    expect(go({ type: 'meeting', relatedType: 'lead', relatedId: 4 })).toBe('/admin/leads/4/edit');
    expect(go({ type: 'meeting' })).toBe('/admin/appointments');
  });
  it('falls back to the stored link, repairs bare lead links, and returns null when nothing is known', () => {
    expect(go({ type: 'something_new', link: '/admin/anything' })).toBe('/admin/anything');
    expect(go({ type: 'something_new', link: '/admin/leads/5' })).toBe('/admin/leads/5/edit');
    expect(go({ type: 'something_new' })).toBeNull();
  });
  it('does not build an opportunity-flow link from an opportunity id', () => {
    expect(go({ type: 'opportunity_created', relatedType: 'opportunity', relatedId: 80 })).toBeNull();
  });
});
