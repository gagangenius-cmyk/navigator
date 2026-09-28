import { Queue } from 'bullmq';
import { getRedisConnection } from '@/lib/redis';

// Real-time delivery path for broadcast recipients, replacing the pure
// cron-poll approach: a recipient is enqueued the instant it's ready to
// send (at launch, or at scheduled_at_utc) instead of waiting up to a
// minute for the next cron tick to notice it. The DB remains the source of
// truth (crm_broadcast_recipients.status/claimed_at) - a BullMQ job here is
// just "please look at this recipient now"; src/lib/broadcastWorker.ts's
// processBroadcastRecipient() does the actual claim-check-send-record work
// and is safe to call twice for the same recipient (idempotency_key +
// status guard), which matters because BullMQ (like any queue) can redeliver
// a job more than once.
export const BROADCAST_QUEUE_NAME = 'broadcast-recipients';

export interface BroadcastRecipientJobData {
  recipientId: number;
}

let queue: Queue<BroadcastRecipientJobData> | null = null;

export function getBroadcastQueue(): Queue<BroadcastRecipientJobData> {
  if (!queue) {
    queue = new Queue<BroadcastRecipientJobData>(BROADCAST_QUEUE_NAME, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { age: 24 * 3600, count: 1000 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    });
  }
  return queue;
}

export async function enqueueBroadcastRecipient(recipientId: number, delayMs = 0): Promise<void> {
  await getBroadcastQueue().add('send', { recipientId }, { delay: delayMs, jobId: `recipient-${recipientId}` });
}
