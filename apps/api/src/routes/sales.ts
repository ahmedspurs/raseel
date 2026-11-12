import {
  dealSchema,
  dealUpdateSchema,
  pipelineSchema,
  taskSchema,
  taskUpdateSchema,
} from '@raseel/shared'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import type { Db, Deal, Prisma, Stage } from '../lib/db.js'
import { currentUser, requireAuth, requirePermission } from '../plugins/auth.js'

/** Created on first use so a fresh install has a working pipeline. */
const DEFAULT_STAGES: { name: string; kind: 'OPEN' | 'WON' | 'LOST' }[] = [
  { name: 'جديد', kind: 'OPEN' },
  { name: 'تم التواصل', kind: 'OPEN' },
  { name: 'عرض سعر', kind: 'OPEN' },
  { name: 'تفاوض', kind: 'OPEN' },
  { name: 'ربح', kind: 'WON' },
  { name: 'خسارة', kind: 'LOST' },
]

async function ensurePipeline(db: Db) {
  const existing = await db.pipeline.findFirst({ orderBy: { position: 'asc' } })
  if (existing) return existing
  return db.pipeline.create({
    data: {
      name: 'المبيعات',
      stages: { create: DEFAULT_STAGES.map((s, position) => ({ ...s, position })) },
    },
  })
}

type DealRow = Deal & {
  stage: Stage
  contact: { id: string; name: string | null; waName: string | null; waId: string }
  owner: { id: string; name: string } | null
  _count?: { tasks: number }
}

function dealDto(d: DealRow) {
  return {
    id: d.id,
    title: d.title,
    pipelineId: d.pipelineId,
    stageId: d.stageId,
    stageKind: d.stage.kind,
    valueSar: Number(d.valueSar),
    expectedClose: d.expectedClose ? d.expectedClose.toISOString().slice(0, 10) : null,
    position: d.position,
    closedAt: d.closedAt,
    owner: d.owner,
    contact: { id: d.contact.id, name: d.contact.name ?? d.contact.waName, waId: d.contact.waId },
    openTasks: d._count?.tasks ?? 0,
    createdAt: d.createdAt,
  }
}

const dealInclude = {
  stage: true,
  contact: { select: { id: true, name: true, waName: true, waId: true } },
  owner: { select: { id: true, name: true } },
  _count: { select: { tasks: { where: { done: false } } } },
} as const

const dealQuery = z.object({ pipelineId: z.string().optional(), contactId: z.string().optional() })
const taskQuery = z.object({
  scope: z.enum(['mine', 'all']).default('mine'),
  done: z.enum(['true', 'false']).optional(),
  contactId: z.string().optional(),
  dealId: z.string().optional(),
})

/** FR-33 (deals pipeline) and FR-34 (tasks and reminders). */
export const salesRoutes: FastifyPluginAsync = async (app) => {
  const { db, audit } = app.ctx
  const canView = requirePermission('contacts:view')
  const canEdit = requirePermission('deals:edit')

  // ── Pipelines ──

  app.get('/pipelines', { preHandler: canView }, async () => {
    await ensurePipeline(db)
    const pipelines = await db.pipeline.findMany({
      orderBy: { position: 'asc' },
      include: { stages: { orderBy: { position: 'asc' } } },
    })
    return { pipelines }
  })

  /** Renames, reorders, adds and removes stages. Stages that still hold deals cannot be removed. */
  app.put(
    '/pipelines/:id',
    { preHandler: requirePermission('settings:manage') },
    async (req, reply) => {
      const { id } = req.params as { id: string }
      const input = pipelineSchema.parse(req.body)
      const pipeline = await db.pipeline.findUnique({ where: { id }, include: { stages: true } })
      if (!pipeline) return reply.code(404).send({ error: 'not_found' })

      const keep = new Set(input.stages.map((s) => s.id).filter(Boolean))
      const removed = pipeline.stages.filter((s) => !keep.has(s.id))
      if (
        removed.length &&
        (await db.deal.count({ where: { stageId: { in: removed.map((s) => s.id) } } }))
      ) {
        return reply.code(409).send({ error: 'stage_has_deals' })
      }
      await db.$transaction([
        db.stage.deleteMany({ where: { id: { in: removed.map((s) => s.id) } } }),
        db.pipeline.update({ where: { id }, data: { name: input.name } }),
        ...input.stages.map((s, position) =>
          s.id && pipeline.stages.some((x) => x.id === s.id)
            ? db.stage.update({
                where: { id: s.id },
                data: { name: s.name, kind: s.kind, position },
              })
            : db.stage.create({ data: { pipelineId: id, name: s.name, kind: s.kind, position } }),
        ),
      ])
      return {
        pipeline: await db.pipeline.findUnique({
          where: { id },
          include: { stages: { orderBy: { position: 'asc' } } },
        }),
      }
    },
  )

  // ── Deals ──

  app.get('/deals', { preHandler: canView }, async (req) => {
    const q = dealQuery.parse(req.query)
    const pipelineId = q.contactId ? undefined : (q.pipelineId ?? (await ensurePipeline(db)).id)
    const deals = await db.deal.findMany({
      where: {
        ...(pipelineId ? { pipelineId } : {}),
        ...(q.contactId ? { contactId: q.contactId } : {}),
      },
      include: dealInclude,
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    })
    return { deals: deals.map(dealDto) }
  })

  app.post('/deals', { preHandler: canEdit }, async (req, reply) => {
    const input = dealSchema.parse(req.body)
    const stage = await db.stage.findUnique({ where: { id: input.stageId } })
    const contact = await db.contact.findUnique({ where: { id: input.contactId } })
    if (!stage || !contact) return reply.code(400).send({ error: 'invalid_reference' })
    const position = await db.deal.count({ where: { stageId: stage.id } })
    const deal = await db.deal.create({
      data: {
        title: input.title,
        contactId: contact.id,
        pipelineId: stage.pipelineId,
        stageId: stage.id,
        valueSar: input.valueSar,
        ownerId: input.ownerId ?? currentUser(req).id,
        expectedClose: input.expectedClose ? new Date(input.expectedClose) : null,
        position,
        closedAt: stage.kind === 'OPEN' ? null : new Date(),
      },
      include: dealInclude,
    })
    return reply.code(201).send({ deal: dealDto(deal) })
  })

  /** Updates a deal; moving it between stages keeps positions consistent for the Kanban board. */
  app.patch('/deals/:id', { preHandler: canEdit }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const input = dealUpdateSchema.parse(req.body)
    const deal = await db.deal.findUnique({ where: { id }, include: { stage: true } })
    if (!deal) return reply.code(404).send({ error: 'not_found' })

    const target = input.stageId
      ? await db.stage.findFirst({ where: { id: input.stageId, pipelineId: deal.pipelineId } })
      : deal.stage
    if (!target) return reply.code(400).send({ error: 'invalid_stage' })

    const data: Prisma.DealUpdateInput = {
      title: input.title,
      valueSar: input.valueSar,
      owner:
        input.ownerId === undefined
          ? undefined
          : input.ownerId
            ? { connect: { id: input.ownerId } }
            : { disconnect: true },
      expectedClose:
        input.expectedClose === undefined
          ? undefined
          : input.expectedClose
            ? new Date(input.expectedClose)
            : null,
    }

    const moving = target.id !== deal.stageId || input.position !== undefined
    const updated = await db.$transaction(async (tx) => {
      if (moving) {
        const others = await tx.deal.findMany({
          where: { stageId: target.id, id: { not: id } },
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
          select: { id: true },
        })
        const at = Math.min(input.position ?? others.length, others.length)
        others.splice(at, 0, { id })
        for (const [position, d] of others.entries()) {
          if (d.id !== id) await tx.deal.update({ where: { id: d.id }, data: { position } })
        }
        data.stage = { connect: { id: target.id } }
        data.position = at
        if (target.id !== deal.stageId) data.closedAt = target.kind === 'OPEN' ? null : new Date()
      }
      return tx.deal.update({ where: { id }, data, include: dealInclude })
    })
    if (target.id !== deal.stageId && target.kind !== 'OPEN') {
      await audit.log({
        userId: currentUser(req).id,
        action: target.kind === 'WON' ? 'deal.won' : 'deal.lost',
        target: id,
        meta: { valueSar: Number(updated.valueSar) },
      })
    }
    return { deal: dealDto(updated) }
  })

  app.delete('/deals/:id', { preHandler: canEdit }, async (req) => {
    const { id } = req.params as { id: string }
    await db.deal.deleteMany({ where: { id } })
    return { ok: true }
  })

  // ── Tasks ──

  const taskInclude = {
    contact: { select: { id: true, name: true, waName: true, waId: true } },
    deal: { select: { id: true, title: true } },
    assignee: { select: { id: true, name: true } },
  } as const

  app.get('/tasks', { preHandler: requireAuth }, async (req) => {
    const q = taskQuery.parse(req.query)
    const user = currentUser(req)
    const tasks = await db.task.findMany({
      where: {
        ...(q.scope === 'mine' && !q.contactId && !q.dealId ? { assigneeId: user.id } : {}),
        ...(q.done ? { done: q.done === 'true' } : {}),
        ...(q.contactId ? { contactId: q.contactId } : {}),
        ...(q.dealId ? { dealId: q.dealId } : {}),
      },
      include: taskInclude,
      orderBy: [{ done: 'asc' }, { dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: 200,
    })
    return { tasks }
  })

  app.post('/tasks', { preHandler: canEdit }, async (req, reply) => {
    const input = taskSchema.parse(req.body)
    const user = currentUser(req)
    let contactId = input.contactId ?? null
    if (input.dealId) {
      const deal = await db.deal.findUnique({ where: { id: input.dealId } })
      if (!deal) return reply.code(400).send({ error: 'invalid_reference' })
      contactId ??= deal.contactId
    }
    const task = await db.task.create({
      data: {
        title: input.title,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        contactId,
        dealId: input.dealId ?? null,
        assigneeId: input.assigneeId ?? user.id,
        createdById: user.id,
      },
      include: taskInclude,
    })
    return reply.code(201).send({ task })
  })

  app.patch('/tasks/:id', { preHandler: canEdit }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const input = taskUpdateSchema.parse(req.body)
    const task = await db.task.findUnique({ where: { id } })
    if (!task) return reply.code(404).send({ error: 'not_found' })
    const updated = await db.task.update({
      where: { id },
      data: {
        title: input.title,
        assigneeId: input.assigneeId,
        ...(input.dueAt !== undefined
          ? { dueAt: input.dueAt ? new Date(input.dueAt) : null, remindedAt: null }
          : {}),
        ...(input.done !== undefined
          ? { done: input.done, doneAt: input.done ? new Date() : null }
          : {}),
      },
      include: taskInclude,
    })
    return { task: updated }
  })

  app.delete('/tasks/:id', { preHandler: canEdit }, async (req) => {
    const { id } = req.params as { id: string }
    await db.task.deleteMany({ where: { id } })
    return { ok: true }
  })
}
