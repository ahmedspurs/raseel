import { extractMentions, noteSchema, quickReplySchema } from '@raseel/shared'
import type { FastifyPluginAsync } from 'fastify'
import type { Note, NoteMention, User } from '../lib/db.js'
import { Prisma } from '../lib/db.js'
import { currentUser, requireAuth, requirePermission } from '../plugins/auth.js'

export function noteDto(
  n: Note & { author: Pick<User, 'id' | 'name'> | null; mentions: Pick<NoteMention, 'userId'>[] },
) {
  return {
    id: n.id,
    conversationId: n.conversationId,
    body: n.body,
    author: n.author ? { id: n.author.id, name: n.author.name } : null,
    mentionedUserIds: n.mentions.map((m) => m.userId),
    createdAt: n.createdAt,
  }
}

const noteInclude = {
  author: { select: { id: true, name: true } },
  mentions: { select: { userId: true } },
} as const

/** FR-17: internal notes inside a conversation, visible only to staff, with @mentions. */
export const noteRoutes: FastifyPluginAsync = async (app) => {
  const { db, events } = app.ctx

  app.get(
    '/conversations/:id/notes',
    { preHandler: requirePermission('conversations:view') },
    async (req) => {
      const { id } = req.params as { id: string }
      const notes = await db.note.findMany({
        where: { conversationId: id },
        include: noteInclude,
        orderBy: { createdAt: 'asc' },
        take: 500,
      })
      return { notes: notes.map(noteDto) }
    },
  )

  app.post(
    '/conversations/:id/notes',
    { preHandler: requirePermission('notes:write') },
    async (req, reply) => {
      const { id } = req.params as { id: string }
      const { body } = noteSchema.parse(req.body)
      const author = currentUser(req)
      if (!(await db.conversation.findUnique({ where: { id }, select: { id: true } }))) {
        return reply.code(404).send({ error: 'not_found' })
      }

      // Only notify real, active colleagues; never the author themselves.
      const mentioned = await db.user.findMany({
        where: { id: { in: extractMentions(body) }, active: true, NOT: { id: author.id } },
        select: { id: true },
      })

      const note = await db.note.create({
        data: {
          conversationId: id,
          authorId: author.id,
          body,
          mentions: { create: mentioned.map((u) => ({ userId: u.id })) },
        },
        include: noteInclude,
      })

      await events.publish({ type: 'note.created', conversationId: id, noteId: note.id })
      for (const u of mentioned) {
        await events.publish({
          type: 'mention.created',
          conversationId: id,
          noteId: note.id,
          userId: u.id,
        })
      }
      return reply.code(201).send({ note: noteDto(note) })
    },
  )

  /** The signed-in user's mentions, newest first. */
  app.get('/mentions', { preHandler: requireAuth }, async (req) => {
    const user = currentUser(req)
    const rows = await db.noteMention.findMany({
      where: { userId: user.id },
      include: {
        note: {
          include: {
            author: { select: { id: true, name: true } },
            conversation: { include: { contact: true } },
          },
        },
      },
      orderBy: { note: { createdAt: 'desc' } },
      take: 50,
    })
    return {
      unread: await db.noteMention.count({ where: { userId: user.id, readAt: null } }),
      mentions: rows.map((m) => ({
        noteId: m.noteId,
        conversationId: m.note.conversationId,
        contactName: m.note.conversation.contact.name ?? m.note.conversation.contact.waName,
        author: m.note.author,
        body: m.note.body,
        createdAt: m.note.createdAt,
        readAt: m.readAt,
      })),
    }
  })

  /** Marks the user's mentions in one conversation (or all) as read. */
  app.post('/mentions/read', { preHandler: requireAuth }, async (req) => {
    const { conversationId } = (req.body ?? {}) as { conversationId?: string }
    const user = currentUser(req)
    const res = await db.noteMention.updateMany({
      where: {
        userId: user.id,
        readAt: null,
        ...(conversationId ? { note: { conversationId } } : {}),
      },
      data: { readAt: new Date() },
    })
    return { updated: res.count }
  })

  // ── FR-18: quick replies ──

  app.get('/quick-replies', { preHandler: requireAuth }, async () => {
    const replies = await db.quickReply.findMany({ orderBy: { shortcut: 'asc' } })
    return {
      quickReplies: replies.map((q) => ({
        id: q.id,
        shortcut: q.shortcut,
        title: q.title,
        body: q.body,
        language: q.language,
      })),
    }
  })

  const saveQuickReply = async (id: string | null, body: unknown, userId: string) => {
    const input = quickReplySchema.parse(body)
    const data = { ...input, language: input.language ?? null }
    try {
      return id
        ? await db.quickReply.update({ where: { id }, data })
        : await db.quickReply.create({ data: { ...data, createdById: userId } })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2002') return 'shortcut_taken' as const
        if (err.code === 'P2025') return 'not_found' as const
      }
      throw err
    }
  }

  app.post(
    '/quick-replies',
    { preHandler: requirePermission('templates:manage') },
    async (req, reply) => {
      const result = await saveQuickReply(null, req.body, currentUser(req).id)
      if (typeof result === 'string') return reply.code(409).send({ error: result })
      return reply.code(201).send({ quickReply: result })
    },
  )

  app.put(
    '/quick-replies/:id',
    { preHandler: requirePermission('templates:manage') },
    async (req, reply) => {
      const { id } = req.params as { id: string }
      const result = await saveQuickReply(id, req.body, currentUser(req).id)
      if (result === 'not_found') return reply.code(404).send({ error: result })
      if (result === 'shortcut_taken') return reply.code(409).send({ error: result })
      return { quickReply: result }
    },
  )

  app.delete(
    '/quick-replies/:id',
    { preHandler: requirePermission('templates:manage') },
    async (req) => {
      const { id } = req.params as { id: string }
      await db.quickReply.deleteMany({ where: { id } })
      return { ok: true }
    },
  )
}
