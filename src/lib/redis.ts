import IORedis from 'ioredis';

// Shared Redis connection for BullMQ (src/lib/queues/*.ts) and the
// standalone worker process (workers/index.ts). Introduced specifically for
// the broadcast/workflow automation feature per explicit direction to use
// Redis + BullMQ as the master spec originally called for - see
// docs/broadcast-architecture.md section 2, which documents this decision
// and supersedes this repo's prior "no Redis anywhere" convention
// (src/lib/jobQueue.ts) for this feature only. Nothing outside
// broadcast/workflow code should depend on this connection.
//
// maxRetriesPerRequest: null is BullMQ's own documented requirement for any
// connection passed to a Queue/Worker - without it, ioredis's default retry
// behavior can silently drop jobs during a transient Redis blip.
let connection: IORedis | null = null;

export function getRedisConnection(): IORedis {
  if (!connection) {
    connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: null,
    });
    connection.on('error', (error) => {
      console.error('Redis connection error:', error);
    });
  }
  return connection;
}
