import { Queue } from 'bullmq';
import { getRedisConnection } from '@/lib/redis';

// Two job types share one queue (rather than two separate queues) since
// they're both "advance this workflow enrollment" events processed by the
// same worker - see workers/index.ts. A wait's resolution is a BullMQ
// *delayed* job scheduled for its exact deadline (src/lib/workflowRuntime.ts's
// createWaitRow), which is what actually replaces the old resolveDueWaits()
// polling sweep with real-time (well, deadline-accurate) firing instead of
// "found within the next minute."
export const WORKFLOW_QUEUE_NAME = 'workflow-engine';

export type WorkflowJobData =
  | { kind: 'step'; stepExecutionId: number }
  | { kind: 'wait_deadline'; waitId: number };

let queue: Queue<WorkflowJobData> | null = null;

export function getWorkflowQueue(): Queue<WorkflowJobData> {
  if (!queue) {
    queue = new Queue<WorkflowJobData>(WORKFLOW_QUEUE_NAME, {
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

export async function enqueueWorkflowStep(stepExecutionId: number): Promise<void> {
  await getWorkflowQueue().add('step', { kind: 'step', stepExecutionId }, { jobId: `step-${stepExecutionId}` });
}

export async function enqueueWaitDeadline(waitId: number, delayMs: number): Promise<void> {
  await getWorkflowQueue().add('wait_deadline', { kind: 'wait_deadline', waitId }, { delay: Math.max(0, delayMs), jobId: `wait-${waitId}` });
}
