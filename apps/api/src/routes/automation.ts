import { automationRuleSchema, automationSettingsSchema } from '@raseel/shared'
import type { FastifyPluginAsync } from 'fastify'
import type { Prisma } from '../lib/db.js'
import { currentUser, requireAuth, requirePermission } from '../plugins/auth.js'

/** FR-50, FR-51, FR-52: working hours, welcome message and keyword rules. */
export const automationRoutes: FastifyPluginAsync = async (app) => {
  const { db, automation, audit } = app.ctx
  const canManage = requirePermission('automations:manage')

  app.get('/settings', { preHandler: requireAuth }, async () => ({
    automation: await automation.getSettings(),
  }))

  app.put('/settings', { preHandler: canManage }, async (req) => {
    const input = automationSettingsSchema.parse(req.body)
    await automation.saveSettings(input)
    await audit.log({
      userId: currentUser(req).id,
      action: 'settings.automation_updated',
      meta: { workingHours: input.workingHours.enabled, welcome: input.welcome.enabled },
      ip: req.ip,
    })
    return { automation: input }
  })

  app.get('/rules', { preHandler: requireAuth }, async () => ({
    rules: await db.automationRule.findMany({
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    }),
  }))

  app.post('/rules', { preHandler: canManage }, async (req, reply) => {
    const input = automationRuleSchema.parse(req.body)
    const rule = await db.automationRule.create({
      data: {
        ...input,
        actions: input.actions as Prisma.InputJsonValue,
        position: await db.automationRule.count(),
      },
    })
    await audit.log({
      userId: currentUser(req).id,
      action: 'automation.rule_created',
      target: rule.id,
    })
    return reply.code(201).send({ rule })
  })

  app.put('/rules/:id', { preHandler: canManage }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const input = automationRuleSchema.parse(req.body)
    const res = await db.automationRule.updateMany({
      where: { id },
      data: { ...input, actions: input.actions as Prisma.InputJsonValue },
    })
    if (!res.count) return reply.code(404).send({ error: 'not_found' })
    return { rule: await db.automationRule.findUnique({ where: { id } }) }
  })

  app.delete('/rules/:id', { preHandler: canManage }, async (req) => {
    const { id } = req.params as { id: string }
    await db.automationRule.deleteMany({ where: { id } })
    await audit.log({ userId: currentUser(req).id, action: 'automation.rule_deleted', target: id })
    return { ok: true }
  })
}
