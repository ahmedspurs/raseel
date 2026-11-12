import type { AppContext } from '../context.js'
import { jobId } from '../lib/queues.js'

/**
 * Safety net for NFR-04: re-queues webhook events and outbound messages whose job
 * never reached Redis (e.g. Redis restarted between the database write and the enqueue).
 * Job ids are deterministic, so work already queued is not duplicated.
 */
export async function runSweep(
  ctx: Pick<AppContext, 'db' | 'queues'>,
  now = new Date(),
): Promise<{ webhookEvents: number; messages: number }> {
  const staleBefore = new Date(now.getTime() - 2 * 60_000)

  const events = await ctx.db.webhookEvent.findMany({
    where: { status: 'PENDING', receivedAt: { lt: staleBefore } },
    select: { id: true },
    take: 500,
  })
  for (const e of events) {
    await ctx.queues.webhook.add('process', { eventId: e.id }, { jobId: jobId('webhook', e.id) })
  }

  const messages = await ctx.db.message.findMany({
    where: { direction: 'OUTBOUND', status: 'QUEUED', createdAt: { lt: staleBefore } },
    select: { id: true },
    take: 500,
  })
  for (const m of messages) {
    await ctx.queues.send.add('send', { messageId: m.id }, { jobId: jobId('send', m.id) })
  }

  return { webhookEvents: events.length, messages: messages.length }
}
