import { customerWindow, MEDIA_LIMITS, mediaKindFor, sendTextSchema } from '@raseel/shared'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import type { Contact, Conversation, Message, User } from '../lib/db.js'
import { currentUser, requirePermission } from '../plugins/auth.js'
import { OutboundError } from '../services/outbound.js'

const listQuery = z.object({
  status: z.enum(['OPEN', 'PENDING', 'CLOSED', 'ALL']).default('ALL'),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
})

const messagesQuery = z.object({
  before: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

type ConversationRow = Conversation & { contact: Contact }

export function conversationDto(c: ConversationRow) {
  const window = customerWindow(c.lastInboundAt)
  return {
    id: c.id,
    status: c.status,
    assigneeId: c.assigneeId,
    teamId: c.teamId,
    unreadCount: c.unreadCount,
    lastMessageAt: c.lastMessageAt,
    lastMessagePreview: c.lastMessagePreview,
    lastInboundAt: c.lastInboundAt,
    windowClosesAt: window.closesAt,
    windowOpen: window.open,
    contact: {
      id: c.contact.id,
      waId: c.contact.waId,
      name: c.contact.name ?? c.contact.waName,
    },
  }
}

export function messageDto(
  m: Message & { sentBy?: Pick<User, 'id' | 'name'> | null },
  replyTo?: { id: string; body: string | null; type: string } | null,
) {
  return {
    id: m.id,
    direction: m.direction,
    type: m.type,
    body: m.body,
    payload: m.payload,
    status: m.status,
    error: m.error,
    media:
      m.mediaId || m.mediaPath
        ? {
            url: m.mediaPath ? `/api/media/${m.id}` : null,
            pending: !m.mediaPath,
            mime: m.mediaMime,
            filename: m.mediaFilename,
          }
        : null,
    replyTo: replyTo ?? null,
    sentBy: m.sentBy ? { id: m.sentBy.id, name: m.sentBy.name } : null,
    createdAt: m.createdAt,
  }
}

export const conversationRoutes: FastifyPluginAsync = async (app) => {
  const { db, outbound, events, config } = app.ctx
  const canView = requirePermission('conversations:view')
  const canReply = requirePermission('conversations:reply')

  app.get('/', { preHandler: canView }, async (req) => {
    const q = listQuery.parse(req.query)
    const rows = await db.conversation.findMany({
      where: q.status === 'ALL' ? {} : { status: q.status },
      include: { contact: true },
      orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    })
    const page = rows.slice(0, q.limit)
    return {
      conversations: page.map(conversationDto),
      nextCursor: rows.length > q.limit ? page.at(-1)?.id : null,
    }
  })

  app.get('/:id', { preHandler: canView }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const c = await db.conversation.findUnique({ where: { id }, include: { contact: true } })
    if (!c) return reply.code(404).send({ error: 'not_found' })
    return { conversation: conversationDto(c) }
  })

  app.get('/:id/messages', { preHandler: canView }, async (req) => {
    const { id } = req.params as { id: string }
    const q = messagesQuery.parse(req.query)
    const rows = await db.message.findMany({
      where: { conversationId: id },
      include: { sentBy: { select: { id: true, name: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      ...(q.before ? { cursor: { id: q.before }, skip: 1 } : {}),
    })
    const page = rows.slice(0, q.limit).reverse()

    const replyIds = [...new Set(page.map((m) => m.replyToWaId).filter((x): x is string => !!x))]
    const targets = replyIds.length
      ? await db.message.findMany({
          where: { waMessageId: { in: replyIds } },
          select: { id: true, body: true, type: true, waMessageId: true },
        })
      : []
    const byWaId = new Map(targets.map((t) => [t.waMessageId, t]))

    return {
      messages: page.map((m) => {
        const t = m.replyToWaId ? byWaId.get(m.replyToWaId) : undefined
        return messageDto(m, t ? { id: t.id, body: t.body, type: t.type } : null)
      }),
      hasMore: rows.length > q.limit,
    }
  })

  app.post('/:id/read', { preHandler: canView }, async (req) => {
    const { id } = req.params as { id: string }
    await db.conversation.updateMany({
      where: { id, unreadCount: { gt: 0 } },
      data: { unreadCount: 0 },
    })
    await events.publish({ type: 'conversation.updated', conversationId: id })
    return { ok: true }
  })

  /** FR-11: send text (JSON) or a file with an optional caption (multipart). */
  app.post('/:id/messages', { preHandler: canReply }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const user = currentUser(req)
    try {
      if (req.isMultipart()) {
        let file: { data: Buffer; mime: string; filename: string } | null = null
        const fields: Record<string, string> = {}
        for await (const part of req.parts({
          limits: { fileSize: config.MEDIA_MAX_MB * 1024 * 1024 },
        })) {
          if (part.type === 'file') {
            const data = await part.toBuffer()
            if (part.file.truncated) return reply.code(413).send({ error: 'file_too_large' })
            file = { data, mime: part.mimetype, filename: part.filename || 'file' }
          } else {
            fields[part.fieldname] = String(part.value)
          }
        }
        if (!file) return reply.code(400).send({ error: 'file_required' })
        const kind = mediaKindFor(file.mime)
        if (file.data.byteLength > MEDIA_LIMITS[kind].maxBytes) {
          return reply
            .code(413)
            .send({ error: 'file_too_large', maxBytes: MEDIA_LIMITS[kind].maxBytes })
        }
        const caption = fields.caption?.trim().slice(0, 1024)
        const message = await outbound.create(id, user.id, {
          kind: 'media',
          data: new Uint8Array(file.data),
          mime: file.mime,
          filename: file.filename,
          caption: kind === 'audio' ? undefined : caption,
          replyToMessageId: fields.replyToMessageId,
        })
        return reply.code(201).send({ message: messageDto({ ...message, sentBy: user }) })
      }

      const input = sendTextSchema.parse(req.body)
      const message = await outbound.create(id, user.id, {
        kind: 'text',
        body: input.body,
        replyToMessageId: input.replyToMessageId,
      })
      return reply.code(201).send({ message: messageDto({ ...message, sentBy: user }) })
    } catch (err) {
      if (err instanceof OutboundError) return reply.code(err.status).send({ error: err.code })
      throw err
    }
  })

  app.post('/:id/messages/:messageId/retry', { preHandler: canReply }, async (req, reply) => {
    const { messageId } = req.params as { id: string; messageId: string }
    if (!(await outbound.retry(messageId))) return reply.code(409).send({ error: 'not_failed' })
    return { ok: true }
  })
}

/** Serves stored media to signed-in staff only. */
export const mediaRoutes: FastifyPluginAsync = async (app) => {
  const { db, media } = app.ctx
  app.get(
    '/:messageId',
    { preHandler: requirePermission('conversations:view'), config: { rateLimit: false } },
    async (req, reply) => {
      const { messageId } = req.params as { messageId: string }
      const message = await db.message.findUnique({ where: { id: messageId } })
      if (!message?.mediaPath) return reply.code(404).send({ error: 'not_found' })
      const file = await media.open(message.mediaPath).catch(() => null)
      if (!file) return reply.code(404).send({ error: 'not_found' })

      const filename = message.mediaFilename ?? `${message.id}`
      reply
        .header('Content-Type', message.mediaMime ?? 'application/octet-stream')
        .header('Content-Length', file.size)
        .header('Cache-Control', 'private, max-age=86400')
        .header('X-Content-Type-Options', 'nosniff')
        .header(
          'Content-Disposition',
          `${message.type === 'DOCUMENT' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(filename)}`,
        )
      return reply.send(file.stream)
    },
  )
}
