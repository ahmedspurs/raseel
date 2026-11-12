import { readFile } from 'node:fs/promises'
import { customerWindow, mediaKindFor } from '@raseel/shared'
import { type Db, type Message, type MessageType, Prisma } from '../lib/db.js'
import { jobId, type Queues } from '../lib/queues.js'
import type { OutboundMessage } from '../whatsapp/client.js'
import { WhatsAppApiError } from '../whatsapp/errors.js'
import { messagePreview } from '../whatsapp/parse.js'
import type { EventBus } from './events.js'
import type { MediaStorage } from './media.js'
import { messageSearchText } from './search.js'
import type { TemplatePayload } from './templates.js'
import type { WhatsAppService } from './whatsapp.js'

export type OutboundInput =
  | { kind: 'text'; body: string; replyToMessageId?: string }
  | {
      kind: 'media'
      data: Uint8Array
      mime: string
      filename: string
      caption?: string
      replyToMessageId?: string
    }

const MEDIA_TYPES = new Set<MessageType>(['IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT'])

export class OutboundError extends Error {
  constructor(
    readonly code: 'not_found' | 'window_closed' | 'not_connected',
    readonly status: number,
  ) {
    super(code)
  }
}

const KIND_TO_TYPE: Record<ReturnType<typeof mediaKindFor>, MessageType> = {
  image: 'IMAGE',
  video: 'VIDEO',
  audio: 'AUDIO',
  document: 'DOCUMENT',
}

interface Deps {
  db: Db
  queues: Queues
  events: EventBus
  whatsapp: WhatsAppService
  media: MediaStorage
}

/** Agent replies: stored first, then sent by the worker with retries (FR-11, NFR-05). */
export class OutboundService {
  constructor(private readonly deps: Deps) {}

  async create(conversationId: string, userId: string, input: OutboundInput): Promise<Message> {
    const { db, queues, events, whatsapp, media } = this.deps
    const conversation = await db.conversation.findUnique({ where: { id: conversationId } })
    if (!conversation) throw new OutboundError('not_found', 404)
    if (!(await whatsapp.credentials())) throw new OutboundError('not_connected', 409)
    // FR-13: free-form messages only inside the 24-hour customer service window.
    if (!customerWindow(conversation.lastInboundAt).open) {
      throw new OutboundError('window_closed', 422)
    }

    let replyToWaId: string | null = null
    if (input.replyToMessageId) {
      const target = await db.message.findFirst({
        where: { id: input.replyToMessageId, conversationId },
        select: { waMessageId: true },
      })
      replyToWaId = target?.waMessageId ?? null
    }

    const type: MessageType =
      input.kind === 'text' ? 'TEXT' : KIND_TO_TYPE[mediaKindFor(input.mime)]
    const body = input.kind === 'text' ? input.body : input.caption?.trim() || null

    let message = await db.message.create({
      data: {
        conversationId,
        direction: 'OUTBOUND',
        type,
        body,
        searchText: messageSearchText(body),
        status: 'QUEUED',
        sentByUserId: userId,
        replyToWaId,
        ...(input.kind === 'media' ? { mediaMime: input.mime, mediaFilename: input.filename } : {}),
      },
    })
    if (input.kind === 'media') {
      const mediaPath = await media.save(message.id, input.data, input.mime, input.filename)
      message = await db.message.update({ where: { id: message.id }, data: { mediaPath } })
    }

    await db.conversation.update({
      where: { id: conversationId },
      data: { lastMessageAt: message.createdAt, lastMessagePreview: messagePreview(type, body) },
    })
    await queues.send.add('send', { messageId: message.id }, { jobId: jobId('send', message.id) })
    await events.publish({ type: 'message.created', conversationId, messageId: message.id })
    await events.publish({ type: 'conversation.updated', conversationId })
    return message
  }

  /**
   * Sends one queued message. Throws to let the queue retry; marks the message FAILED
   * when the error is permanent or this was the last attempt.
   */
  async send(messageId: string, opts: { finalAttempt: boolean }): Promise<'sent' | 'skipped'> {
    const { db, events, whatsapp, media } = this.deps
    const message = await db.message.findUnique({
      where: { id: messageId },
      include: { conversation: { include: { contact: true } } },
    })
    if (!message || message.status !== 'QUEUED') return 'skipped'

    try {
      const client = await whatsapp.client()

      let mediaId = message.mediaId
      if (MEDIA_TYPES.has(message.type) && !mediaId) {
        if (!message.mediaPath || !message.mediaMime) {
          throw new WhatsAppApiError('Media file is missing', { code: -2 })
        }
        const data = new Uint8Array(await readFile(media.resolve(message.mediaPath)))
        mediaId = await client.uploadMedia(
          data,
          message.mediaMime.split(';')[0]!.trim(),
          message.mediaFilename ?? 'file',
        )
        // Persist so a retry does not upload the file again.
        await db.message.update({ where: { id: message.id }, data: { mediaId } })
      }

      const { waMessageId } = await client.sendMessage(
        message.conversation.contact.waId,
        toOutbound(message, mediaId),
        { replyToWaId: message.replyToWaId ?? undefined },
      )
      await db.message.update({
        where: { id: message.id },
        data: { waMessageId, status: 'SENT', error: Prisma.DbNull },
      })
      await events.publish({
        type: 'message.updated',
        conversationId: message.conversationId,
        messageId: message.id,
      })
      return 'sent'
    } catch (err) {
      const apiErr =
        err instanceof WhatsAppApiError ? err : new WhatsAppApiError((err as Error).message)
      const permanent = !apiErr.retryable || opts.finalAttempt
      await db.message.update({
        where: { id: message.id },
        data: { error: apiErr.toJSON(), ...(permanent ? { status: 'FAILED' } : {}) },
      })
      if (permanent) {
        await events.publish({
          type: 'message.updated',
          conversationId: message.conversationId,
          messageId: message.id,
        })
      }
      throw new SendFailure(apiErr, permanent)
    }
  }

  /**
   * Messages sent by automations (welcome, away, keyword replies). They follow the
   * customer's message, so the 24-hour window is open; optional reply buttons are
   * sent as an interactive message.
   */
  async createAutomated(
    conversationId: string,
    input: { body: string; buttons?: string[] },
  ): Promise<Message> {
    const { db, queues, events } = this.deps
    const buttons = (input.buttons ?? []).filter(Boolean).slice(0, 3)
    const interactive = buttons.length
      ? {
          type: 'button',
          body: { text: input.body },
          action: {
            buttons: buttons.map((title, i) => ({
              type: 'reply',
              reply: { id: `btn_${i + 1}`, title: title.slice(0, 20) },
            })),
          },
        }
      : null
    const message = await db.message.create({
      data: {
        conversationId,
        direction: 'OUTBOUND',
        type: interactive ? 'INTERACTIVE' : 'TEXT',
        body: input.body,
        searchText: messageSearchText(input.body),
        payload: interactive ? { interactive, buttons } : undefined,
        status: 'QUEUED',
        automated: true,
      },
    })
    await db.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: message.createdAt,
        lastMessagePreview: messagePreview(message.type, input.body),
      },
    })
    await queues.send.add('send', { messageId: message.id }, { jobId: jobId('send', message.id) })
    await events.publish({ type: 'message.created', conversationId, messageId: message.id })
    return message
  }

  /** Sends a read receipt (blue ticks) for a customer's message. Best effort. */
  async markRead(messageId: string): Promise<boolean> {
    const { db, whatsapp } = this.deps
    const message = await db.message.findUnique({ where: { id: messageId } })
    if (!message?.waMessageId || message.direction !== 'INBOUND') return false
    const client = await whatsapp.client()
    await client.markRead(message.waMessageId)
    return true
  }

  /** Re-queues a failed message (agent clicks "retry"). */
  async retry(messageId: string): Promise<boolean> {
    const { db, queues } = this.deps
    const updated = await db.message.updateMany({
      where: { id: messageId, direction: 'OUTBOUND', status: 'FAILED' },
      data: { status: 'QUEUED', error: Prisma.DbNull },
    })
    if (updated.count === 0) return false
    await queues.send.remove(jobId('send', messageId)).catch(() => undefined)
    await queues.send.add('send', { messageId }, { jobId: jobId('send', messageId) })
    return true
  }
}

export class SendFailure extends Error {
  constructor(
    readonly cause: WhatsAppApiError,
    readonly permanent: boolean,
  ) {
    super(cause.message)
  }
}

function toOutbound(message: Message, mediaId: string | null): OutboundMessage {
  const caption = message.body ?? undefined
  switch (message.type) {
    case 'TEXT':
      return { type: 'text', text: { body: message.body ?? '', preview_url: true } }
    case 'IMAGE':
      return { type: 'image', image: { id: mediaId!, caption } }
    case 'VIDEO':
      return { type: 'video', video: { id: mediaId!, caption } }
    case 'AUDIO':
      return { type: 'audio', audio: { id: mediaId! } }
    case 'DOCUMENT':
      return {
        type: 'document',
        document: { id: mediaId!, caption, filename: message.mediaFilename ?? undefined },
      }
    case 'INTERACTIVE': {
      const { interactive } = message.payload as { interactive: Record<string, unknown> }
      return { type: 'interactive', interactive }
    }
    case 'TEMPLATE': {
      const { template } = message.payload as unknown as TemplatePayload
      return { type: 'template', template }
    }
    default:
      throw new WhatsAppApiError(`Cannot send messages of type ${message.type}`, { code: -3 })
  }
}
