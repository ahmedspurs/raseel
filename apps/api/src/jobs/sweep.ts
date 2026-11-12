import type { AppContext } from '../context.js'
import { jobId } from '../lib/queues.js'

/**
 * Safety net for NFR-04: re-queues webhook events and outbound messages whose job
 * never reached Redis (e.g. Redis restarted between the database write and the enqueue).
 * Job ids are deterministic, so work already queued is not duplicated.
 */
export async function runSweep(
  ctx: Pick<AppContext, 'db' | 'queues' | 'events'>,
  now = new Date(),
): Promise<{ webhookEvents: number; messages: number; reminders: number }> {
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

  // FR-34: remind assignees once when a task falls due.
  const due = await ctx.db.task.findMany({
    where: { done: false, remindedAt: null, dueAt: { lte: now }, assigneeId: { not: null } },
    select: { id: true, title: true, assigneeId: true },
    take: 200,
  })
  for (const t of due) {
    await ctx.events.publish({
      type: 'task.due',
      taskId: t.id,
      userId: t.assigneeId!,
      title: t.title,
    })
  }
  if (due.length) {
    await ctx.db.task.updateMany({
      where: { id: { in: due.map((t) => t.id) } },
      data: { remindedAt: now },
    })
  }

  return { webhookEvents: events.length, messages: messages.length, reminders: due.length }
}
