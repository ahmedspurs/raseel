import { Queue, UnrecoverableError, Worker } from 'bullmq'
import { closeContext, createContext } from './bootstrap.js'
import { runMaintenance } from './jobs/maintenance.js'
import { runSweep } from './jobs/sweep.js'
import { createLogger } from './lib/logger.js'
import { type MediaJob, QueueName, type SendJob, type WebhookJob } from './lib/queues.js'
import { SendFailure } from './services/outbound.js'
import { WhatsAppApiError } from './whatsapp/errors.js'

/**
 * Background worker (BullMQ on Redis): processes Meta webhooks, sends agent replies
 * with retries, downloads media and runs scheduled maintenance.
 */
const ctx = createContext()
const log = createLogger(ctx.config)
const connection = ctx.redis

const maintenanceQueue = new Queue(QueueName.Maintenance, { connection })
await maintenanceQueue.upsertJobScheduler(
  'hourly-maintenance',
  { every: 60 * 60 * 1000 },
  { name: 'maintenance', opts: { removeOnComplete: 50, removeOnFail: 100 } },
)
await maintenanceQueue.upsertJobScheduler(
  'minute-sweep',
  { every: 60 * 1000 },
  { name: 'sweep', opts: { removeOnComplete: 10, removeOnFail: 100 } },
)

const isFinalAttempt = (job: { attemptsMade: number; opts: { attempts?: number } }) =>
  job.attemptsMade + 1 >= (job.opts.attempts ?? 1)

const workers = [
  // One at a time keeps messages from the same customer in order.
  new Worker<WebhookJob>(
    QueueName.Webhook,
    async (job) => ctx.inbound.processWebhookEvent(job.data.eventId),
    { connection, concurrency: 1 },
  ),

  new Worker<SendJob>(
    QueueName.Send,
    async (job) => {
      try {
        return await ctx.outbound.send(job.data.messageId, { finalAttempt: isFinalAttempt(job) })
      } catch (err) {
        // Permanent errors (closed window, invalid number…) must not be retried.
        if (err instanceof SendFailure && err.permanent) throw new UnrecoverableError(err.message)
        throw err
      }
    },
    { connection, concurrency: 1 },
  ),

  new Worker<MediaJob>(
    QueueName.Media,
    async (job) => {
      try {
        return await ctx.inbound.downloadMedia(job.data.messageId)
      } catch (err) {
        if (err instanceof WhatsAppApiError && !err.retryable)
          throw new UnrecoverableError(err.message)
        throw err
      }
    },
    { connection, concurrency: 2 },
  ),

  new Worker(
    QueueName.Maintenance,
    async (job) => (job.name === 'sweep' ? runSweep(ctx) : runMaintenance(ctx)),
    { connection, concurrency: 1 },
  ),
]

workers[0]!.on('failed', async (job) => {
  if (job && isFinalAttempt(job)) {
    await ctx.db.webhookEvent
      .update({ where: { id: (job.data as WebhookJob).eventId }, data: { status: 'FAILED' } })
      .catch(() => undefined)
  }
})

for (const worker of workers) {
  worker.on('completed', (job, result) =>
    log.debug({ queue: job.queueName, id: job.id, result }, 'job completed'),
  )
  worker.on('failed', (job, err) =>
    log.warn(
      { queue: job?.queueName, id: job?.id, attempts: job?.attemptsMade, err: err.message },
      'job failed',
    ),
  )
}
log.info({ queues: workers.map((w) => w.name) }, 'worker started')

const shutdown = async (signal: string) => {
  log.info({ signal }, 'worker shutting down')
  await Promise.all(workers.map((w) => w.close()))
  await maintenanceQueue.close()
  await closeContext(ctx)
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))
