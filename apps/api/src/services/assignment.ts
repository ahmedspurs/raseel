import {
  type ConversationListQuery,
  type ConversationUpdate,
  can,
  DEFAULT_INBOX_SETTINGS,
  type InboxSettings,
  type InboxView,
} from '@raseel/shared'
import type { Redis } from 'ioredis'
import type { Db, Prisma, User } from '../lib/db.js'
import type { AuditService } from './audit.js'
import type { EventBus } from './events.js'
import { SettingKey, type SettingsService } from './settings.js'

export class AssignmentError extends Error {
  constructor(
    readonly code: 'not_found' | 'invalid_assignee' | 'invalid_team' | 'forbidden',
    readonly status: number,
  ) {
    super(code)
  }
}

const ROUND_ROBIN_KEY = 'raseel:inbox:round-robin'

/** FR-14: maps an inbox view and filters to a database query for one user. */
export function conversationWhere(
  q: Pick<ConversationListQuery, 'view' | 'status' | 'assigneeId' | 'teamId' | 'from' | 'to'>,
  user: Pick<User, 'id'>,
  teamIds: string[],
): Prisma.ConversationWhereInput {
  const where: Prisma.ConversationWhereInput = {}
  where.status = q.view === 'closed' ? 'CLOSED' : q.status ? q.status : { in: ['OPEN', 'PENDING'] }
  if (q.view === 'mine') where.assigneeId = user.id
  if (q.view === 'unassigned') where.assigneeId = null
  if (q.view === 'team') where.teamId = { in: teamIds }
  if (q.assigneeId) where.assigneeId = q.assigneeId
  if (q.teamId) where.teamId = q.teamId
  if (q.from || q.to) {
    where.lastMessageAt = {
      ...(q.from ? { gte: new Date(`${q.from}T00:00:00.000Z`) } : {}),
      ...(q.to ? { lte: new Date(`${q.to}T23:59:59.999Z`) } : {}),
    }
  }
  return where
}

interface Deps {
  db: Db
  redis: Redis
  settings: SettingsService
  events: EventBus
  audit: AuditService
}

/** FR-15 and FR-16: assignment to agents and teams, round robin, and status changes. */
export class AssignmentService {
  constructor(private readonly deps: Deps) {}

  async inboxSettings(): Promise<InboxSettings> {
    return (
      (await this.deps.settings.getJson<InboxSettings>(SettingKey.InboxSettings)) ??
      DEFAULT_INBOX_SETTINGS
    )
  }

  async saveInboxSettings(input: InboxSettings): Promise<void> {
    await this.deps.settings.setJson(SettingKey.InboxSettings, input)
  }

  async counts(user: Pick<User, 'id'>, teamIds: string[]): Promise<Record<InboxView, number>> {
    const views: InboxView[] = ['mine', 'unassigned', 'team', 'all', 'closed']
    const values = await Promise.all(
      views.map((view) =>
        // Closed is unbounded; it is only shown as a link, so skip counting it.
        view === 'closed'
          ? Promise.resolve(0)
          : this.deps.db.conversation.count({ where: conversationWhere({ view }, user, teamIds) }),
      ),
    )
    return Object.fromEntries(views.map((v, i) => [v, values[i]!])) as Record<InboxView, number>
  }

  /** Users who receive round-robin assignments: active, allowed to reply, ordered stably. */
  private async eligibleAgents(settings: InboxSettings): Promise<string[]> {
    const users = await this.deps.db.user.findMany({
      where: {
        active: true,
        ...(settings.autoAssign.userIds.length
          ? { id: { in: settings.autoAssign.userIds } }
          : { role: { in: ['AGENT', 'ADMIN'] } }),
      },
      select: { id: true, role: true },
      orderBy: { createdAt: 'asc' },
    })
    return users.filter((u) => can(u.role, 'conversations:reply')).map((u) => u.id)
  }

  /** Assigns an unassigned conversation to the next agent in turn. */
  async autoAssign(conversationId: string): Promise<string | null> {
    const settings = await this.inboxSettings()
    if (!settings.autoAssign.enabled) return null
    const agents = await this.eligibleAgents(settings)
    if (!agents.length) return null

    const turn = await this.deps.redis.incr(ROUND_ROBIN_KEY)
    const assigneeId = agents[(turn - 1) % agents.length]!
    // Only if still unassigned, so a manual assignment is never overwritten.
    const res = await this.deps.db.conversation.updateMany({
      where: { id: conversationId, assigneeId: null },
      data: { assigneeId },
    })
    if (res.count === 0) return null

    await this.deps.audit.log({
      action: 'conversation.auto_assigned',
      target: conversationId,
      meta: { assigneeId },
    })
    await this.deps.events.publish({ type: 'conversation.updated', conversationId })
    return assigneeId
  }

  async update(conversationId: string, actor: User, input: ConversationUpdate, ip?: string) {
    const { db, audit, events } = this.deps
    const conversation = await db.conversation.findUnique({ where: { id: conversationId } })
    if (!conversation) throw new AssignmentError('not_found', 404)

    const changesAssignment = input.assigneeId !== undefined || input.teamId !== undefined
    if (changesAssignment && !can(actor.role, 'conversations:assign')) {
      throw new AssignmentError('forbidden', 403)
    }
    if (input.status !== undefined && !can(actor.role, 'conversations:reply')) {
      throw new AssignmentError('forbidden', 403)
    }

    if (input.assigneeId) {
      const assignee = await db.user.findUnique({ where: { id: input.assigneeId } })
      if (!assignee?.active || !can(assignee.role, 'conversations:reply')) {
        throw new AssignmentError('invalid_assignee', 400)
      }
    }
    if (input.teamId && !(await db.team.findUnique({ where: { id: input.teamId } }))) {
      throw new AssignmentError('invalid_team', 400)
    }

    const data: Prisma.ConversationUpdateInput = {}
    if (input.assigneeId !== undefined) {
      data.assignee = input.assigneeId
        ? { connect: { id: input.assigneeId } }
        : { disconnect: true }
    }
    if (input.teamId !== undefined) {
      data.team = input.teamId ? { connect: { id: input.teamId } } : { disconnect: true }
    }
    if (input.status !== undefined && input.status !== conversation.status) {
      data.status = input.status
      data.closedAt = input.status === 'CLOSED' ? new Date() : null
    }

    const updated = await db.conversation.update({
      where: { id: conversationId },
      data,
      include: { contact: true },
    })

    // FR-62: assignments are part of the audit trail.
    if (changesAssignment) {
      await audit.log({
        userId: actor.id,
        action: 'conversation.assigned',
        target: conversationId,
        meta: { assigneeId: input.assigneeId ?? null, teamId: input.teamId ?? null },
        ip,
      })
    }
    if (data.status) {
      await audit.log({
        userId: actor.id,
        action: 'conversation.status_changed',
        target: conversationId,
        meta: { from: conversation.status, to: input.status! },
        ip,
      })
    }
    await events.publish({ type: 'conversation.updated', conversationId })
    return updated
  }
}
