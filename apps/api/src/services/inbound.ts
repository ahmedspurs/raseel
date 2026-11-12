import { type Db, type MessageStatus, Prisma } from '../lib/db.js'
import { jobId, type Queues } from '../lib/queues.js'
import {
  type InboundMessage,
  messagePreview,
  parseWebhook,
  type StatusUpdate,
} from '../whatsapp/parse.js'
import type { EventBus } from './events.js'
import type { MediaStorage } from './media.js'
import type { WhatsAppService } from './whatsapp.js'

/** Statuses only move forward; a late "delivered" never overwrites "read". */
const STATUS_RANK: Record<MessageStatus, number> = {
  RECEIVED: -1,
  QUEUED: 0,
  SENT: 1,
  DELIVERED: 2,
  READ: 3,
  FAILED: 4,
}

const STATUS_MAP = {
  sent: 'SENT',
  delivered: 'DELIVERED',
  read: 'READ',
  failed: 'FAILED',
} as const satisfies Record<StatusUpdate['status'], MessageStatus>

const later = (a: Date | null, b: Date) => (a && a > b ? a : b)

interface Deps {
  db: Db
  queues: Queues
  events: EventBus
  whatsapp: WhatsAppService
  media: MediaStorage
}

/** Turns stored webhook events into contacts, conversations, messages and statuses. */
export class InboundService {
  constructor(private readonly deps: Deps) {}

  async processWebhookEvent(eventId: string): Promise<{ messages: number; statuses: number }> {
    const { db, whatsapp } = this.deps
    const event = await db.webhookEvent.findUnique({ where: { id: eventId } })
    if (!event || event.status === 'PROCESSED') return { messages: 0, statuses: 0 }

    const creds = await whatsapp.credentials()
    const parsed = parseWebhook(event.payload, creds?.phoneNumberId ?? null)
    try {
      for (const m of parsed.messages) await this.handleMessage(m)
      for (const s of parsed.statuses) await this.handleStatus(s)
      await db.webhookEvent.update({
        where: { id: eventId },
        data: { status: 'PROCESSED', processedAt: new Date(), error: null },
      })
    } catch (err) {
      await db.webhookEvent.update({
        where: { id: eventId },
        data: { attempts: { increment: 1 }, error: (err as Error).message.slice(0, 1000) },
      })
      throw err
    }
    return { messages: parsed.messages.length, statuses: parsed.statuses.length }
  }

  /** FR-10, FR-16, FR-30. Idempotent: Meta may deliver the same webhook more than once. */
  async handleMessage(m: InboundMessage): Promise<string | null> {
    const { db, queues, events } = this.deps
    if (await db.message.findUnique({ where: { waMessageId: m.waMessageId } })) return null

    const contact = await db.contact.upsert({
      where: { waId: m.from },
      create: { waId: m.from, waName: m.profileName },
      update: m.profileName ? { waName: m.profileName } : {},
    })

    const existing = await db.conversation.findFirst({
      where: { contactId: contact.id },
      orderBy: { createdAt: 'desc' },
    })
    const conversation =
      existing ?? (await db.conversation.create({ data: { contactId: contact.id } }))

    let messageId: string
    try {
      messageId = await db.$transaction(async (tx) => {
        const message = await tx.message.create({
          data: {
            conversationId: conversation.id,
            direction: 'INBOUND',
            type: m.type,
            body: m.body,
            payload: (m.payload ?? undefined) as Prisma.InputJsonValue | undefined,
            mediaId: m.media?.id,
            mediaMime: m.media?.mimeType,
            mediaFilename: m.media?.filename,
            waMessageId: m.waMessageId,
            replyToWaId: m.replyToWaId,
            status: 'RECEIVED',
            createdAt: m.timestamp,
          },
        })
        await tx.conversation.update({
          where: { id: conversation.id },
          data: {
            lastInboundAt: later(conversation.lastInboundAt, m.timestamp),
            lastMessageAt: later(conversation.lastMessageAt, m.timestamp),
            lastMessagePreview: messagePreview(m.type, m.body),
            unreadCount: { increment: 1 },
            // FR-16: a customer writing again reopens the conversation.
            status: 'OPEN',
            closedAt: null,
          },
        })
        return message.id
      })
    } catch (err) {
      // Lost a race with a duplicate delivery of the same message.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return null
      throw err
    }

    if (m.media) {
      await queues.media.add('download', { messageId }, { jobId: jobId('media', messageId) })
    }
    await events.publish({ type: 'message.created', conversationId: conversation.id, messageId })
    await events.publish({ type: 'conversation.updated', conversationId: conversation.id })
    return messageId
  }

  /** FR-12: sent → delivered → read, or failed with Meta's reason. */
  async handleStatus(s: StatusUpdate): Promise<boolean> {
    const { db, events } = this.deps
    const message = await db.message.findUnique({ where: { waMessageId: s.waMessageId } })
    if (!message || message.direction !== 'OUTBOUND') return false

    const next = STATUS_MAP[s.status]
    const current = message.status
    const advance =
      next === 'FAILED'
        ? current !== 'READ'
        : current !== 'FAILED' && STATUS_RANK[next] > STATUS_RANK[current]
    if (!advance) return false

    await db.message.update({
      where: { id: message.id },
      data: { status: next, ...(s.error ? { error: s.error } : {}) },
    })
    await events.publish({
      type: 'message.updated',
      conversationId: message.conversationId,
      messageId: message.id,
    })
    return true
  }

  /** Downloads inbound media to local storage (Meta's URLs expire after a few minutes). */
  async downloadMedia(messageId: string): Promise<boolean> {
    const { db, whatsapp, media, events } = this.deps
    const message = await db.message.findUnique({ where: { id: messageId } })
    if (!message?.mediaId || message.mediaPath) return false

    const client = await whatsapp.client()
    const info = await client.getMedia(message.mediaId)
    const data = await client.downloadMedia(info.url, 100 * 1024 * 1024)
    const mime = info.mimeType ?? message.mediaMime
    const mediaPath = await media.save(message.id, data, mime, message.mediaFilename)
    await db.message.update({ where: { id: message.id }, data: { mediaPath, mediaMime: mime } })
    await events.publish({
      type: 'message.updated',
      conversationId: message.conversationId,
      messageId: message.id,
    })
    return true
  }
}
