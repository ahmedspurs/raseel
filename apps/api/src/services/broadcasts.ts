import type { BroadcastInput, SegmentFilter, TemplateSendInput } from '@raseel/shared'
import { segmentFilterSchema } from '@raseel/shared'
import type { Broadcast, Db, Prisma } from '../lib/db.js'
import { jobId, type Queues } from '../lib/queues.js'
import type { AuditService } from './audit.js'
import type { OutboundService } from './outbound.js'
import { SendFailure } from './outbound.js'
import { TemplateError, type TemplateService } from './templates.js'

export class BroadcastError extends Error {
  constructor(
    readonly code: 'not_found' | 'template_not_approved' | 'not_editable' | 'empty_audience',
    readonly status: number,
  ) {
    super(code)
  }
}

/** FR-35: contacts matching a segment filter. */
export function segmentWhere(filter: SegmentFilter): Prisma.ContactWhereInput {
  const and: Prisma.ContactWhereInput[] = []
  if (filter.tagIds.length) {
    if (filter.tagMatch === 'all') {
      for (const tagId of filter.tagIds) and.push({ tags: { some: { tagId } } })
    } else {
      and.push({ tags: { some: { tagId: { in: filter.tagIds } } } })
    }
  }
  for (const [key, value] of Object.entries(filter.fields)) {
    and.push({ customFields: { path: [key], equals: value } })
  }
  if (filter.language) and.push({ language: filter.language })
  return and.length ? { AND: and } : {}
}

/** Broadcasts only ever reach contacts who agreed to marketing messages (FR-42). */
export function audienceWhere(filter: SegmentFilter | null): Prisma.ContactWhereInput {
  return { AND: [filter ? segmentWhere(filter) : {}, { optInMarketing: true }] }
}

export interface BroadcastStats {
  total: number
  pending: number
  skipped: number
  failed: number
  sent: number
  delivered: number
  read: number
  replied: number
}

interface Deps {
  db: Db
  queues: Queues
  templates: TemplateService
  outbound: OutboundService
  audit: AuditService
}

/** FR-42 and FR-43: template campaigns to opted-in segments, with delivery reports. */
export class BroadcastService {
  constructor(private readonly deps: Deps) {}

  private async filterOf(segmentId: string | null): Promise<SegmentFilter | null> {
    if (!segmentId) return null
    const segment = await this.deps.db.segment.findUnique({ where: { id: segmentId } })
    if (!segment) throw new BroadcastError('not_found', 404)
    return segmentFilterSchema.parse(segment.filter)
  }

  async audienceSize(segmentId: string | null): Promise<number> {
    return this.deps.db.contact.count({ where: audienceWhere(await this.filterOf(segmentId)) })
  }

  async create(input: BroadcastInput, userId: string): Promise<Broadcast> {
    const { db, queues } = this.deps
    const template = await db.template.findUnique({ where: { id: input.templateId } })
    if (!template || template.status !== 'APPROVED') {
      throw new BroadcastError('template_not_approved', 422)
    }
    if ((await this.audienceSize(input.segmentId)) === 0) {
      throw new BroadcastError('empty_audience', 422)
    }

    const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : new Date()
    const broadcast = await db.broadcast.create({
      data: {
        name: input.name,
        templateId: input.templateId,
        segmentId: input.segmentId,
        variables: input.variables as Prisma.InputJsonValue,
        headerMediaUrl: input.headerMediaUrl ?? null,
        status: 'SCHEDULED',
        scheduledAt,
        createdById: userId,
      },
    })
    await queues.broadcast.add(
      'start',
      { kind: 'start', broadcastId: broadcast.id },
      {
        jobId: jobId('broadcast-start', broadcast.id),
        delay: Math.max(0, scheduledAt.getTime() - Date.now()),
      },
    )
    return broadcast
  }

  /** Expands the audience into recipients and queues one rate-limited send each. */
  async start(broadcastId: string): Promise<number> {
    const { db, queues } = this.deps
    const claimed = await db.broadcast.updateMany({
      where: { id: broadcastId, status: 'SCHEDULED' },
      data: { status: 'SENDING', startedAt: new Date() },
    })
    if (!claimed.count) return 0
    const broadcast = await db.broadcast.findUniqueOrThrow({ where: { id: broadcastId } })

    const contacts = await db.contact.findMany({
      where: audienceWhere(await this.filterOf(broadcast.segmentId)),
      select: { id: true },
    })
    await db.broadcastRecipient.createMany({
      data: contacts.map((c) => ({ broadcastId, contactId: c.id })),
      skipDuplicates: true,
    })
    const recipients = await db.broadcastRecipient.findMany({
      where: { broadcastId, status: 'PENDING' },
      select: { id: true },
    })
    await queues.broadcast.addBulk(
      recipients.map((r) => ({
        name: 'send',
        data: { kind: 'send' as const, recipientId: r.id },
        opts: { jobId: jobId('broadcast-send', r.id) },
      })),
    )
    if (!recipients.length) await this.finishIfDone(broadcastId)
    return recipients.length
  }

  /**
   * Sends to one recipient. Idempotent: a retry reuses the message created by the
   * first attempt. Throws on temporary errors so the queue retries with back-off.
   */
  async sendOne(recipientId: string, opts: { finalAttempt: boolean }): Promise<string> {
    const { db, templates, outbound } = this.deps
    const recipient = await db.broadcastRecipient.findUnique({
      where: { id: recipientId },
      include: { broadcast: true, contact: true },
    })
    if (!recipient || !['PENDING', 'QUEUED'].includes(recipient.status)) return 'skipped'
    const { broadcast, contact } = recipient

    const skip = async (error: string) => {
      await db.broadcastRecipient.update({
        where: { id: recipientId },
        data: { status: 'SKIPPED', error },
      })
      await this.finishIfDone(broadcast.id)
      return 'skipped'
    }
    if (broadcast.status === 'CANCELLED') return skip('cancelled')
    // Consent may have been withdrawn since the broadcast was created (FR-44).
    if (!contact.optInMarketing) return skip('opted_out')

    let messageId = recipient.messageId
    if (!messageId) {
      try {
        const message = await templates.send(
          contact.id,
          broadcast.createdById,
          {
            templateId: broadcast.templateId,
            variables: broadcast.variables as TemplateSendInput['variables'],
            headerMediaUrl: broadcast.headerMediaUrl ?? undefined,
          },
          { enqueue: false, reopen: false },
        )
        messageId = message.id
        await db.broadcastRecipient.update({
          where: { id: recipientId },
          data: { messageId, status: 'QUEUED' },
        })
      } catch (err) {
        if (err instanceof TemplateError) return this.fail(recipientId, broadcast.id, err.code)
        throw err
      }
    }

    try {
      await outbound.send(messageId, opts)
    } catch (err) {
      if (err instanceof SendFailure && !err.permanent) throw err
      return this.fail(
        recipientId,
        broadcast.id,
        err instanceof Error ? err.message : 'send_failed',
      )
    }
    await this.finishIfDone(broadcast.id)
    return 'sent'
  }

  private async fail(recipientId: string, broadcastId: string, error: string) {
    await this.deps.db.broadcastRecipient.update({
      where: { id: recipientId },
      data: { status: 'FAILED', error: error.slice(0, 500) },
    })
    await this.finishIfDone(broadcastId)
    return 'failed'
  }

  /** Marks the broadcast complete once no recipient is waiting to be sent. */
  private async finishIfDone(broadcastId: string) {
    const { db } = this.deps
    // QUEUED recipients have handed their message to the send pipeline; the
    // minute sweep re-queues any message that stalls there.
    const waiting = await db.broadcastRecipient.count({ where: { broadcastId, status: 'PENDING' } })
    if (waiting === 0) {
      await db.broadcast.updateMany({
        where: { id: broadcastId, status: 'SENDING' },
        data: { status: 'COMPLETED', completedAt: new Date() },
      })
    }
  }

  async cancel(broadcastId: string, userId: string): Promise<void> {
    const { db, queues, audit } = this.deps
    const res = await db.broadcast.updateMany({
      where: { id: broadcastId, status: { in: ['SCHEDULED', 'SENDING'] } },
      data: { status: 'CANCELLED', completedAt: new Date() },
    })
    if (!res.count) throw new BroadcastError('not_editable', 409)
    await queues.broadcast.remove(jobId('broadcast-start', broadcastId)).catch(() => undefined)
    await db.broadcastRecipient.updateMany({
      where: { broadcastId, status: 'PENDING' },
      data: { status: 'SKIPPED', error: 'cancelled' },
    })
    await audit.log({ userId, action: 'broadcast.cancelled', target: broadcastId })
  }

  /** FR-43: sent, delivered, read, replied and failed counts. */
  async stats(broadcastId: string): Promise<BroadcastStats> {
    const rows = await this.deps.db.$queryRaw<
      {
        total: bigint
        pending: bigint
        skipped: bigint
        failed: bigint
        sent: bigint
        delivered: bigint
        read: bigint
        replied: bigint
      }[]
    >`
      SELECT
        count(*) AS total,
        count(*) FILTER (WHERE r.status = 'PENDING' OR (r.status = 'QUEUED' AND m.status = 'QUEUED')) AS pending,
        count(*) FILTER (WHERE r.status = 'SKIPPED') AS skipped,
        count(*) FILTER (WHERE r.status = 'FAILED' OR m.status = 'FAILED') AS failed,
        count(*) FILTER (WHERE m.status IN ('SENT', 'DELIVERED', 'READ')) AS sent,
        count(*) FILTER (WHERE m.status IN ('DELIVERED', 'READ')) AS delivered,
        count(*) FILTER (WHERE m.status = 'READ') AS read,
        count(*) FILTER (WHERE m.id IS NOT NULL AND EXISTS (
          SELECT 1 FROM messages i
          WHERE i.conversation_id = m.conversation_id
            AND i.direction = 'INBOUND'
            AND i.created_at > m.created_at
        )) AS replied
      FROM broadcast_recipients r
      LEFT JOIN messages m ON m.id = r.message_id
      WHERE r.broadcast_id = ${broadcastId}`
    const r = rows[0]!
    return Object.fromEntries(
      Object.entries(r).map(([k, v]) => [k, Number(v)]),
    ) as unknown as BroadcastStats
  }
}
