import type { AppContext } from '../context.js'

const DAY = 86_400_000

/** Removes expired sessions, stale invitations and old processed webhook payloads. */
export async function runMaintenance(ctx: Pick<AppContext, 'db'>, now = new Date()) {
  const [sessions, invitations, webhookEvents] = await Promise.all([
    ctx.db.session.deleteMany({ where: { expiresAt: { lt: now } } }),
    ctx.db.invitation.deleteMany({
      where: { acceptedAt: null, expiresAt: { lt: new Date(now.getTime() - 30 * DAY) } },
    }),
    ctx.db.webhookEvent.deleteMany({
      where: { status: 'PROCESSED', processedAt: { lt: new Date(now.getTime() - 30 * DAY) } },
    }),
  ])
  return {
    sessions: sessions.count,
    invitations: invitations.count,
    webhookEvents: webhookEvents.count,
  }
}
