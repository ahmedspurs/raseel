import { broadcastSchema, segmentFilterSchema, segmentSchema } from '@raseel/shared'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { Prisma } from '../lib/db.js'
import { currentUser, requirePermission } from '../plugins/auth.js'
import { audienceWhere, BroadcastError, segmentWhere } from '../services/broadcasts.js'

const previewSchema = z.object({ filter: segmentFilterSchema })

/** FR-35, FR-42, FR-43: segments, broadcasts and their reports. */
export const broadcastRoutes: FastifyPluginAsync = async (app) => {
  const { db, broadcasts, audit } = app.ctx
  const canManage = requirePermission('broadcasts:manage')
  const canView = requirePermission('reports:view')

  // ── Segments ──

  app.get('/segments', { preHandler: canView }, async () => {
    const segments = await db.segment.findMany({ orderBy: { name: 'asc' } })
    return {
      segments: await Promise.all(
        segments.map(async (s) => ({
          ...s,
          // Opted-in contacts only: who a broadcast to this segment would reach.
          audience: await db.contact.count({
            where: audienceWhere(segmentFilterSchema.parse(s.filter)),
          }),
        })),
      ),
    }
  })

  /** Live audience count while building a segment. */
  app.post('/segments/preview', { preHandler: canView }, async (req) => {
    const { filter } = previewSchema.parse(req.body)
    const [audience, matching] = await Promise.all([
      db.contact.count({ where: audienceWhere(filter) }),
      db.contact.count({ where: segmentWhere(filter) }),
    ])
    return { audience, matching }
  })

  app.post('/segments', { preHandler: canManage }, async (req, reply) => {
    const input = segmentSchema.parse(req.body)
    try {
      const segment = await db.segment.create({
        data: { name: input.name, filter: input.filter as Prisma.InputJsonValue },
      })
      return reply.code(201).send({ segment })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.code(409).send({ error: 'name_taken' })
      }
      throw err
    }
  })

  app.put('/segments/:id', { preHandler: canManage }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const input = segmentSchema.parse(req.body)
    const res = await db.segment.updateMany({
      where: { id },
      data: { name: input.name, filter: input.filter as Prisma.InputJsonValue },
    })
    if (!res.count) return reply.code(404).send({ error: 'not_found' })
    return { segment: await db.segment.findUnique({ where: { id } }) }
  })

  app.delete('/segments/:id', { preHandler: canManage }, async (req) => {
    const { id } = req.params as { id: string }
    await db.segment.deleteMany({ where: { id } })
    return { ok: true }
  })

  // ── Broadcasts ──

  app.get('/broadcasts', { preHandler: canView }, async () => {
    const rows = await db.broadcast.findMany({
      orderBy: { createdAt: 'desc' },
      include: { segment: { select: { id: true, name: true } } },
      take: 100,
    })
    const templates = await db.template.findMany({
      where: { id: { in: rows.map((b) => b.templateId) } },
      select: { id: true, name: true, language: true },
    })
    return {
      broadcasts: await Promise.all(
        rows.map(async (b) => ({
          ...b,
          template: templates.find((t) => t.id === b.templateId) ?? null,
          stats: await broadcasts.stats(b.id),
        })),
      ),
    }
  })

  app.get('/broadcasts/:id', { preHandler: canView }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const broadcast = await db.broadcast.findUnique({
      where: { id },
      include: { segment: true, createdBy: { select: { id: true, name: true } } },
    })
    if (!broadcast) return reply.code(404).send({ error: 'not_found' })
    const [stats, template, recipients] = await Promise.all([
      broadcasts.stats(id),
      db.template.findUnique({ where: { id: broadcast.templateId } }),
      db.broadcastRecipient.findMany({
        where: { broadcastId: id },
        include: { contact: { select: { id: true, name: true, waName: true, waId: true } } },
        orderBy: { createdAt: 'asc' },
        take: 200,
      }),
    ])
    const messages = await db.message.findMany({
      where: { id: { in: recipients.map((r) => r.messageId).filter((x): x is string => !!x) } },
      select: { id: true, status: true, error: true },
    })
    return {
      broadcast,
      template,
      stats,
      recipients: recipients.map((r) => {
        const m = messages.find((x) => x.id === r.messageId)
        return {
          id: r.id,
          status: r.status,
          error: r.error,
          messageStatus: m?.status ?? null,
          messageError: m?.error ?? null,
          contact: {
            id: r.contact.id,
            name: r.contact.name ?? r.contact.waName,
            waId: r.contact.waId,
          },
        }
      }),
    }
  })

  app.post('/broadcasts/audience', { preHandler: canView }, async (req) => {
    const { segmentId } = z.object({ segmentId: z.string().nullable() }).parse(req.body)
    return { audience: await broadcasts.audienceSize(segmentId) }
  })

  app.post('/broadcasts', { preHandler: canManage }, async (req, reply) => {
    const input = broadcastSchema.parse(req.body)
    const user = currentUser(req)
    try {
      const broadcast = await broadcasts.create(input, user.id)
      await audit.log({
        userId: user.id,
        action: 'broadcast.created',
        target: broadcast.id,
        meta: {
          segmentId: input.segmentId,
          scheduledAt: broadcast.scheduledAt?.toISOString() ?? null,
        },
        ip: req.ip,
      })
      return reply.code(201).send({ broadcast })
    } catch (err) {
      if (err instanceof BroadcastError) return reply.code(err.status).send({ error: err.code })
      throw err
    }
  })

  app.post('/broadcasts/:id/cancel', { preHandler: canManage }, async (req, reply) => {
    const { id } = req.params as { id: string }
    try {
      await broadcasts.cancel(id, currentUser(req).id)
      return { ok: true }
    } catch (err) {
      if (err instanceof BroadcastError) return reply.code(err.status).send({ error: err.code })
      throw err
    }
  })
}
