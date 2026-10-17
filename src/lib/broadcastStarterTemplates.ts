import { CrmMessageTemplates, CrmMessageTemplateVersions, CrmAutomationAuditLogs } from '@/models';
import { templateVersionContentHash } from './broadcastTemplateHash';
import { extractVariableTokens } from './broadcastTemplateRender';

// Ready-made appointment / follow-up / payment-reminder email templates.
// Variable tokens use the names from broadcastContextKeys.ts so the campaign
// wizard's "Quick add" chips map straight onto them. Installed already
// published (email templates need no external approval), then freely
// editable in the template editor - editing creates a new version, the
// installed one is never mutated.

interface Starter { name: string; category: string; subject: string; heading: string; body: string[]; cta?: string }

const STARTERS: Starter[] = [
  {
    name: 'Appointment confirmation', category: 'appointment',
    subject: 'Your appointment is confirmed - {{appointment_date}}',
    heading: 'Your appointment is confirmed',
    body: [
      'Hello {{first_name}},',
      'Your consultation is booked for <strong>{{appointment_date}} at {{appointment_time}}</strong> with {{counselor_name}} at our {{branch_name}} office ({{branch_address}}).',
      'Please bring your passport and any documents you would like to discuss. If you need to change the time, reply to this email or call {{counselor_phone}}.',
    ],
  },
  {
    name: 'Appointment reminder - 24 hours', category: 'appointment',
    subject: 'Reminder: your appointment is tomorrow',
    heading: 'Your appointment is tomorrow',
    body: [
      'Hello {{first_name}},',
      'This is a friendly reminder of your appointment on <strong>{{appointment_date}} at {{appointment_time}}</strong> with {{counselor_name}} ({{branch_name}}).',
      'Need to reschedule? Reply to this email or call {{counselor_phone}}.',
    ],
  },
  {
    name: 'Appointment reminder - 2 hours', category: 'appointment',
    subject: 'Your appointment is today at {{appointment_time}}',
    heading: 'See you soon',
    body: [
      'Hello {{first_name}},',
      'Your appointment with {{counselor_name}} is today at <strong>{{appointment_time}}</strong>. Our address: {{branch_address}}.',
      'If you are running late, please call {{counselor_phone}}.',
    ],
  },
  {
    name: 'Appointment rescheduled', category: 'appointment',
    subject: 'Your appointment has been rescheduled',
    heading: 'Your appointment has a new time',
    body: [
      'Hello {{first_name}},',
      'Your appointment with {{counselor_name}} is now scheduled for <strong>{{appointment_date}} at {{appointment_time}}</strong> at our {{branch_name}} office.',
      'If this time does not suit you, reply to this email and we will find another slot.',
    ],
  },
  {
    name: 'Missed appointment follow-up', category: 'follow_up',
    subject: 'We missed you - let us rebook your consultation',
    heading: 'We missed you',
    body: [
      'Hello {{first_name}},',
      'We were expecting you for your consultation but could not connect. No problem - reply to this email or call {{counselor_phone}} and {{counselor_name}} will arrange a new time that suits you.',
    ],
  },
  {
    name: 'After consultation follow-up', category: 'follow_up',
    subject: 'Thank you for meeting with us, {{first_name}}',
    heading: 'Thank you for your time',
    body: [
      'Hello {{first_name}},',
      'It was a pleasure speaking with you. If you have any questions about the next steps, or would like to go ahead, simply reply to this email or call {{counselor_name}} on {{counselor_phone}}.',
    ],
  },
  {
    name: 'Follow-up - no response', category: 'follow_up',
    subject: 'Just checking in, {{first_name}}',
    heading: 'Just checking in',
    body: [
      'Hello {{first_name}},',
      'We reached out recently and wanted to make sure you received our message. Are you still interested in moving forward? {{counselor_name}} is happy to answer any questions - reply here or call {{counselor_phone}}.',
    ],
  },
  {
    name: 'Documents pending reminder', category: 'follow_up',
    subject: 'Documents needed to continue your application',
    heading: 'We are waiting for your documents',
    body: [
      'Hello {{first_name}},',
      'To keep your application moving, we still need the documents discussed with {{counselor_name}}. Please reply to this email with the files attached, or visit our {{branch_name}} office.',
    ],
  },
  {
    name: 'Payment balance reminder', category: 'payment_reminder',
    subject: 'Payment reminder - balance of {{balance_due}}',
    heading: 'A friendly payment reminder',
    body: [
      'Hello {{first_name}},',
      'Our records show an outstanding balance of <strong>{{balance_due}}</strong>, due on <strong>{{due_date}}</strong>.',
      'To arrange payment or discuss an instalment plan, please reply to this email or contact {{counselor_name}} on {{counselor_phone}}.',
    ],
  },
];

const renderHtml = (s: Starter) => `<!doctype html><html><body style="margin:0;background:#f4f6f8;font-family:Arial,Helvetica,sans-serif;color:#1f2933">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px">
<tr><td style="padding:24px 28px;border-bottom:3px solid #1d4ed8"><h1 style="margin:0;font-size:20px;color:#1d4ed8">${s.heading}</h1></td></tr>
<tr><td style="padding:24px 28px;font-size:15px;line-height:1.6">${s.body.map((p) => `<p style="margin:0 0 14px">${p}</p>`).join('')}
<p style="margin:20px 0 0;color:#52606d;font-size:13px">{{branch_name}} - {{branch_phone}}</p></td></tr>
</table></td></tr></table></body></html>`;

export async function installStarterTemplates(actor: { id: number; branch?: number | null }) {
  const created: string[] = [];
  const skipped: string[] = [];
  for (const starter of STARTERS) {
    const existing = await CrmMessageTemplates.findOne({ where: { name: starter.name, channel: 'email', isDeleted: false } });
    if (existing) { skipped.push(starter.name); continue; }

    const html = renderHtml(starter);
    const components = { subject: starter.subject };
    const tokens = extractVariableTokens(`${starter.subject} ${html}`);
    const template = await CrmMessageTemplates.create({
      branchId: actor.branch ?? null,
      channel: 'email',
      name: starter.name,
      category: starter.category,
      language: 'en',
      folder: 'Starter templates',
      tags: null,
      providerTemplateId: null,
      status: 'approved',
      currentDraftVersionId: null,
      currentPublishedVersionId: null,
      ownerId: actor.id,
    });
    const version = await CrmMessageTemplateVersions.create({
      templateId: template.id,
      versionNumber: 1,
      channel: 'email',
      components,
      designJson: null,
      exportHtml: html,
      exportText: null,
      variableSchema: tokens.map((name) => ({ name, type: 'string', required: true })),
      sampleValues: null,
      contentHash: templateVersionContentHash(components, undefined),
      createdBy: actor.id,
      isPublished: true,
      publishedAt: new Date(),
    });
    await template.update({ currentDraftVersionId: version.id, currentPublishedVersionId: version.id });
    await CrmAutomationAuditLogs.create({
      actorId: actor.id,
      action: 'template.starter_installed',
      branchId: template.branchId,
      objectType: 'message_template',
      objectId: template.id,
      metadata: { name: starter.name, category: starter.category },
    });
    created.push(starter.name);
  }
  return { created, skipped };
}
