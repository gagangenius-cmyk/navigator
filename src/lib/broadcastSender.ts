import { QueryTypes } from 'sequelize';
import { sequelize } from './sequelize';
import { sendEmail } from './mailer';
import { broadcastDailyLimit, broadcastSentToday, getMailboxForLeadOwner, sendFromMailbox } from './mailboxes';

// Which mailbox a campaign's email goes out from.
//   company        - the shared company sender (Resend), as before.
//   owner_mailbox  - the lead's own counselor's connected SMTP mailbox, so the
//                    client sees the email from the person they actually deal
//                    with, replies land in that counselor's inbox, and the
//                    message is filed on the lead's timeline.
// Stored in a small side table (not a column on crm_broadcast_campaigns) so
// every existing campaign query keeps working untouched.

export type SenderMode = 'company' | 'owner_mailbox';
export type SenderFallback = 'company' | 'skip';
export interface SenderSettings { mode: SenderMode; fallback: SenderFallback }

let ready: Promise<void> | null = null;
const ensureTable = async () => {
  if (!ready) {
    ready = sequelize.query(`
      CREATE TABLE IF NOT EXISTS crm_broadcast_campaign_sender (
        campaign_id INT NOT NULL PRIMARY KEY,
        sender_mode VARCHAR(16) NOT NULL DEFAULT 'company',
        sender_fallback VARCHAR(16) NOT NULL DEFAULT 'skip',
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `).then(() => undefined).catch((error) => { ready = null; throw error; });
  }
  await ready;
};

export async function getSenderSettings(campaignId: number): Promise<SenderSettings> {
  await ensureTable();
  const [row] = await sequelize.query<{ sender_mode: string; sender_fallback: string }>(
    'SELECT sender_mode, sender_fallback FROM crm_broadcast_campaign_sender WHERE campaign_id = :campaignId',
    { replacements: { campaignId }, type: QueryTypes.SELECT },
  );
  return {
    mode: row?.sender_mode === 'owner_mailbox' ? 'owner_mailbox' : 'company',
    fallback: row?.sender_fallback === 'company' ? 'company' : 'skip',
  };
}

export async function setSenderSettings(campaignId: number, settings: SenderSettings) {
  await ensureTable();
  await sequelize.query(
    `INSERT INTO crm_broadcast_campaign_sender (campaign_id, sender_mode, sender_fallback)
     VALUES (:campaignId, :mode, :fallback)
     ON DUPLICATE KEY UPDATE sender_mode = VALUES(sender_mode), sender_fallback = VALUES(sender_fallback)`,
    { replacements: { campaignId, ...settings } },
  );
}

export const parseSenderSettings = (input: { senderMode?: unknown; senderFallback?: unknown }): SenderSettings => ({
  mode: input.senderMode === 'owner_mailbox' ? 'owner_mailbox' : 'company',
  fallback: input.senderFallback === 'company' ? 'company' : 'skip',
});

// The mailbox's broadcast cap is reached: a temporary, self-resolving
// condition, so the worker re-queues the recipient instead of failing it.
export class MailboxThrottledError extends Error {
  constructor(message: string) { super(message); this.name = 'MailboxThrottledError'; }
}

const htmlToText = (html: string) =>
  html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<br\s*\/?>|<\/p>|<\/div>|<\/h\d>|<\/tr>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n').trim();

export async function sendCampaignEmail(input: {
  settings: SenderSettings; leadId: number | null; to: string; subject: string; html: string;
}): Promise<{ providerMessageId: string | null; via: 'owner_mailbox' | 'company' }> {
  const text = htmlToText(input.html);
  if (input.settings.mode === 'owner_mailbox' && input.leadId) {
    const mailbox = await getMailboxForLeadOwner(input.leadId);
    if (mailbox) {
      if ((await broadcastSentToday(mailbox.id)) >= broadcastDailyLimit()) {
        throw new MailboxThrottledError(`Broadcast limit of ${broadcastDailyLimit()} emails/day reached for ${mailbox.email}`);
      }
      const result = await sendFromMailbox(mailbox, {
        to: input.to, subject: input.subject, body: text, html: input.html, leadId: input.leadId, source: 'broadcast',
      });
      return { providerMessageId: result.messageId ?? null, via: 'owner_mailbox' };
    }
    if (input.settings.fallback === 'skip') {
      throw new Error("The lead's counselor has no connected mailbox (campaign is set to not fall back to the company sender)");
    }
  }
  const result = await sendEmail({ to: input.to, subject: input.subject, html: input.html, text });
  return { providerMessageId: (result as { id?: string })?.id ?? null, via: 'company' };
}
