import { canAssignRole, inviteUserSchema, updateUserSchema } from '@raseel/shared'
import type { FastifyPluginAsync } from 'fastify'
import { randomToken, sha256 } from '../lib/crypto.js'
import { currentUser, requireAuth, requirePermission } from '../plugins/auth.js'
import { toPublicUser } from '../services/auth.js'

const INVITE_TTL_MS = 7 * 86_400_000

/** FR-61: users, invitations, role changes and deactivation. */
export const userRoutes: FastifyPluginAsync = async (app) => {
  const { db, audit, config, mailer } = app.ctx

  /** Any signed-in user may list colleagues (needed for assignment and @mentions). */
  app.get('/', { preHandler: requireAuth }, async () => {
    const users = await db.user.findMany({
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      include: { teams: { select: { teamId: true } } },
    })
    return {
      users: users.map((u) => ({
        ...toPublicUser(u),
        lastLoginAt: u.lastLoginAt,
        teamIds: u.teams.map((t) => t.teamId),
      })),
    }
  })

  app.get('/invitations', { preHandler: requirePermission('users:manage') }, async () => {
    const invitations = await db.invitation.findMany({
      where: { acceptedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, email: true, name: true, role: true, expiresAt: true, createdAt: true },
    })
    return { invitations }
  })

  app.post(
    '/invitations',
    { preHandler: requirePermission('users:manage') },
    async (req, reply) => {
      const input = inviteUserSchema.parse(req.body)
      const actor = currentUser(req)
      if (!canAssignRole(actor.role, input.role)) {
        return reply.code(403).send({ error: 'cannot_assign_role' })
      }
      if (await db.user.findUnique({ where: { email: input.email } })) {
        return reply.code(409).send({ error: 'email_taken' })
      }

      const token = randomToken(32)
      const invitation = await db.invitation.create({
        data: {
          email: input.email,
          name: input.name,
          role: input.role,
          teamIds: input.teamIds,
          tokenHash: sha256(token),
          invitedById: actor.id,
          expiresAt: new Date(Date.now() + INVITE_TTL_MS),
        },
      })
      const link = `${config.APP_URL}/invite/${token}`
      const emailed = await mailer
        .send({
          to: input.email,
          subject: 'You are invited to Raseel · دعوة للانضمام إلى رسيل',
          text:
            `${actor.name} invited you to join the team inbox.\n` +
            `${actor.name} دعاك للانضمام إلى صندوق الفريق.\n\n${link}\n\n` +
            `This link expires in 7 days. · ينتهي الرابط خلال 7 أيام.`,
        })
        .catch((err: unknown) => {
          req.log.warn({ err }, 'failed to send invitation email')
          return false
        })

      await audit.log({
        userId: actor.id,
        action: 'user.invited',
        target: input.email,
        meta: { role: input.role },
        ip: req.ip,
      })
      // The link is returned so the inviter can share it when SMTP is not configured.
      return reply.code(201).send({ id: invitation.id, link, emailed })
    },
  )

  app.delete('/invitations/:id', { preHandler: requirePermission('users:manage') }, async (req) => {
    const { id } = req.params as { id: string }
    await db.invitation.deleteMany({ where: { id, acceptedAt: null } })
    await audit.log({ userId: currentUser(req).id, action: 'user.invitation_revoked', target: id })
    return { ok: true }
  })

  app.patch('/:id', { preHandler: requirePermission('users:manage') }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const input = updateUserSchema.parse(req.body)
    const actor = currentUser(req)
    const target = await db.user.findUnique({ where: { id } })
    if (!target) return reply.code(404).send({ error: 'not_found' })
    if (target.id === actor.id) return reply.code(400).send({ error: 'cannot_modify_self' })
    if (target.role === 'OWNER') return reply.code(403).send({ error: 'cannot_modify_owner' })
    if (!canAssignRole(actor.role, target.role)) {
      return reply.code(403).send({ error: 'insufficient_role' })
    }
    if (input.role && !canAssignRole(actor.role, input.role)) {
      return reply.code(403).send({ error: 'cannot_assign_role' })
    }

    const updated = await db.$transaction(async (tx) => {
      if (input.teamIds) {
        await tx.teamMember.deleteMany({ where: { userId: id } })
        const teams = await tx.team.findMany({
          where: { id: { in: input.teamIds } },
          select: { id: true },
        })
        await tx.teamMember.createMany({ data: teams.map((t) => ({ teamId: t.id, userId: id })) })
      }
      if (input.active === false) await tx.session.deleteMany({ where: { userId: id } })
      return tx.user.update({
        where: { id },
        data: { role: input.role, active: input.active },
      })
    })

    await audit.log({
      userId: actor.id,
      action: 'user.updated',
      target: id,
      meta: { ...input },
      ip: req.ip,
    })
    return { user: toPublicUser(updated) }
  })
}
