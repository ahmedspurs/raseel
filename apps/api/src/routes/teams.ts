import { teamSchema } from '@raseel/shared'
import type { FastifyPluginAsync } from 'fastify'
import { Prisma } from '../lib/db.js'
import { currentUser, requireAuth, requirePermission } from '../plugins/auth.js'

export const teamRoutes: FastifyPluginAsync = async (app) => {
  const { db, audit } = app.ctx

  /** Drops ids that do not belong to an existing user. */
  const existingUserIds = async (ids: string[]) =>
    (await db.user.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((u) => u.id)

  app.get('/', { preHandler: requireAuth }, async () => {
    const teams = await db.team.findMany({
      orderBy: { name: 'asc' },
      include: { members: { select: { userId: true } } },
    })
    return {
      teams: teams.map((t) => ({
        id: t.id,
        name: t.name,
        memberIds: t.members.map((m) => m.userId),
      })),
    }
  })

  app.post('/', { preHandler: requirePermission('teams:manage') }, async (req, reply) => {
    const input = teamSchema.parse(req.body)
    input.memberIds = await existingUserIds(input.memberIds)
    try {
      const team = await db.team.create({
        data: {
          name: input.name,
          members: { create: input.memberIds.map((userId) => ({ userId })) },
        },
      })
      await audit.log({ userId: currentUser(req).id, action: 'team.created', target: team.id })
      return reply
        .code(201)
        .send({ team: { id: team.id, name: team.name, memberIds: input.memberIds } })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.code(409).send({ error: 'name_taken' })
      }
      throw err
    }
  })

  app.put('/:id', { preHandler: requirePermission('teams:manage') }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const input = teamSchema.parse(req.body)
    input.memberIds = await existingUserIds(input.memberIds)
    const exists = await db.team.findUnique({ where: { id } })
    if (!exists) return reply.code(404).send({ error: 'not_found' })
    await db.$transaction([
      db.teamMember.deleteMany({ where: { teamId: id } }),
      db.team.update({
        where: { id },
        data: {
          name: input.name,
          members: { create: input.memberIds.map((userId) => ({ userId })) },
        },
      }),
    ])
    await audit.log({ userId: currentUser(req).id, action: 'team.updated', target: id })
    return { team: { id, name: input.name, memberIds: input.memberIds } }
  })

  app.delete('/:id', { preHandler: requirePermission('teams:manage') }, async (req) => {
    const { id } = req.params as { id: string }
    await db.team.deleteMany({ where: { id } })
    await audit.log({ userId: currentUser(req).id, action: 'team.deleted', target: id })
    return { ok: true }
  })
}
