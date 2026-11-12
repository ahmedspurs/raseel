import { templateCreateSchema, templateSendSchema } from '@raseel/shared'
import type { FastifyPluginAsync, FastifyReply } from 'fastify'
import { currentUser, requirePermission } from '../plugins/auth.js'
import { TemplateError } from '../services/templates.js'
import { loadMessageDto } from './conversations.js'

function handle(reply: FastifyReply, err: unknown) {
  if (err instanceof TemplateError) {
    return reply.code(err.status).send({ error: err.code, detail: err.detail ?? null })
  }
  throw err
}

/** FR-40, FR-41: templates synced from Meta, created and submitted, and sent to contacts. */
export const templateRoutes: FastifyPluginAsync = async (app) => {
  const { db, templates, audit } = app.ctx

  app.get('/templates', { preHandler: requirePermission('conversations:view') }, async () => {
    const rows = await db.template.findMany({ orderBy: [{ status: 'asc' }, { name: 'asc' }] })
    return {
      templates: rows.map((t) => ({
        id: t.id,
        name: t.name,
        language: t.language,
        category: t.category,
        status: t.status,
        rejectedReason: t.rejectedReason,
        components: t.components,
        syncedAt: t.syncedAt,
      })),
    }
  })

  app.post(
    '/templates/sync',
    { preHandler: requirePermission('templates:manage') },
    async (req, reply) => {
      try {
        const result = await templates.sync()
        await audit.log({
          userId: currentUser(req).id,
          action: 'templates.synced',
          meta: result,
          ip: req.ip,
        })
        return result
      } catch (err) {
        return handle(reply, err)
      }
    },
  )

  app.post(
    '/templates',
    { preHandler: requirePermission('templates:manage') },
    async (req, reply) => {
      const input = templateCreateSchema.parse(req.body)
      try {
        const template = await templates.create(input)
        await audit.log({
          userId: currentUser(req).id,
          action: 'template.submitted',
          target: template.name,
          ip: req.ip,
        })
        return reply.code(201).send({ template })
      } catch (err) {
        return handle(reply, err)
      }
    },
  )

  app.delete(
    '/templates/:id',
    { preHandler: requirePermission('templates:manage') },
    async (req, reply) => {
      const { id } = req.params as { id: string }
      try {
        await templates.remove(id)
        await audit.log({
          userId: currentUser(req).id,
          action: 'template.deleted',
          target: id,
          ip: req.ip,
        })
        return { ok: true }
      } catch (err) {
        return handle(reply, err)
      }
    },
  )

  /** Sends a template to a contact; starts or reopens their conversation. */
  app.post(
    '/contacts/:id/template',
    { preHandler: requirePermission('conversations:reply') },
    async (req, reply) => {
      const { id } = req.params as { id: string }
      const input = templateSendSchema.parse(req.body)
      try {
        const message = await templates.send(id, currentUser(req).id, input)
        return reply.code(201).send({
          conversationId: message.conversationId,
          message: await loadMessageDto(db, message.id),
        })
      } catch (err) {
        return handle(reply, err)
      }
    },
  )
}
