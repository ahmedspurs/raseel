import { type JobsOptions, Queue } from 'bullmq'
import type { Redis } from 'ioredis'

export const QueueName = {
  Webhook: 'webhook',
  Send: 'send',
  Media: 'media',
  Maintenance: 'maintenance',
} as const

export interface WebhookJob {
  eventId: string
}
export interface SendJob {
  messageId: string
}
export interface MediaJob {
  messageId: string
}

/** Retries with exponential back-off: ~2s, 4s, 8s … (NFR-04, NFR-05). */
const RETRY: JobsOptions = {
  attempts: 8,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 7 * 86_400 },
}

export interface Queues {
  webhook: Queue<WebhookJob>
  send: Queue<SendJob>
  media: Queue<MediaJob>
  close(): Promise<void>
}

export function createQueues(connection: Redis): Queues {
  const webhook = new Queue<WebhookJob>(QueueName.Webhook, {
    connection,
    defaultJobOptions: RETRY,
  })
  const send = new Queue<SendJob>(QueueName.Send, {
    connection,
    defaultJobOptions: { ...RETRY, attempts: 6 },
  })
  const media = new Queue<MediaJob>(QueueName.Media, {
    connection,
    defaultJobOptions: { ...RETRY, attempts: 5 },
  })
  return {
    webhook,
    send,
    media,
    async close() {
      await Promise.all([webhook.close(), send.close(), media.close()])
    },
  }
}

/** Uses the record id as the job id so the same work is never queued twice. */
export const jobId = (kind: string, id: string) => `${kind}-${id}`
