import { Queue, Worker } from 'bullmq'
import { closeContext, createContext } from './bootstrap.js'
import { runMaintenance } from './jobs/maintenance.js'
import { createLogger } from './lib/logger.js'

/**
 * Background worker (BullMQ on Redis). Runs scheduled maintenance now;
 * webhook processing and outbound sends are added as their own queues.
 */
const ctx = createContext()
const log = createLogger(ctx.config)
const connection = ctx.redis

const maintenanceQueue = new Queue('maintenance', { connection })
await maintenanceQueue.upsertJobScheduler(
  'hourly-maintenance',
  { every: 60 * 60 * 1000 },
  { name: 'maintenance', opts: { removeOnComplete: 50, removeOnFail: 100 } },
)

const workers = [
  new Worker('maintenance', async () => runMaintenance(ctx), { connection, concurrency: 1 }),
]

for (const worker of workers) {
  worker.on('completed', (job, result) =>
    log.info({ queue: job.queueName, result }, 'job completed'),
  )
  worker.on('failed', (job, err) => log.error({ queue: job?.queueName, err }, 'job failed'))
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
