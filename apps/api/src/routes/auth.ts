import {
  acceptInviteSchema,
  changePasswordSchema,
  loginSchema,
  updateProfileSchema,
} from '@raseel/shared'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { sha256 } from '../lib/crypto.js'
import { clearSessionCookie, setSessionCookie } from '../lib/http.js'
import { currentUser, requireAuth } from '../plugins/auth.js'
import { SESSION_COOKIE, toPublicUser } from '../services/auth.js'

const totpTokenSchema = z.object({ token: z.string().regex(/^\d{6}$/) })
const disable2faSchema = z.object({
  password: z.string().min(1).max(128),
  token: z.string().regex(/^\d{6}$/),
})

const pendingTotpKey = (userId: string) => `raseel:totp:pending:${userId}`

export const authRoutes: FastifyPluginAsync = async (app) => {
  const { db, auth, audit, config, redis, cipher } = app.ctx
  /** Strict limit for credential endpoints (NFR-09). */
  const credentialLimit = {
    rateLimit: { max: config.AUTH_RATE_LIMIT_MAX, timeWindow: '15 minutes' },
  }

  app.post('/login', { config: credentialLimit }, async (req, reply) => {
    const input = loginSchema.parse(req.body)
    const user = await db.user.findUnique({ where: { email: input.email } })
    const passwordOk = await auth.verifyPassword(user?.passwordHash ?? null, input.password)

    if (!user || !passwordOk || !user.active) {
      await audit.log({
        userId: user?.id,
        action: 'auth.login_failed',
        target: input.email,
        ip: req.ip,
      })
      return reply.code(401).send({ error: 'invalid_credentials' })
    }

    if (user.totpSecret) {
      if (!input.totp) return reply.code(401).send({ error: 'totp_required' })
      if (!(await auth.verifyTotp(user.totpSecret, input.totp))) {
        await audit.log({ userId: user.id, action: 'auth.totp_failed', ip: req.ip })
        return reply.code(401).send({ error: 'invalid_totp' })
      }
    }

    const session = await auth.createSession(user.id, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    })
    await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } })
    await audit.log({ userId: user.id, action: 'auth.login', ip: req.ip })
    setSessionCookie(reply, config, session.token, session.expiresAt)
    return { user: toPublicUser(user) }
  })

  app.post('/logout', async (req, reply) => {
    const raw = req.cookies[SESSION_COOKIE]
    const unsigned = raw ? req.unsignCookie(raw) : null
    if (unsigned?.valid && unsigned.value) await auth.destroySession(unsigned.value)
    clearSessionCookie(reply)
    return { ok: true }
  })

  app.get('/me', { preHandler: requireAuth }, async (req) => {
    const user = currentUser(req)
    const teams = await db.teamMember.findMany({
      where: { userId: user.id },
      select: { team: { select: { id: true, name: true } } },
    })
    return { user: toPublicUser(user), teams: teams.map((t) => t.team) }
  })

  /** FR-64: per-user interface language. */
  app.patch('/me', { preHandler: requireAuth }, async (req) => {
    const input = updateProfileSchema.parse(req.body)
    const user = await db.user.update({ where: { id: currentUser(req).id }, data: input })
    return { user: toPublicUser(user) }
  })

  app.post(
    '/me/password',
    { preHandler: requireAuth, config: credentialLimit },
    async (req, reply) => {
      const input = changePasswordSchema.parse(req.body)
      const user = currentUser(req)
      if (!(await auth.verifyPassword(user.passwordHash, input.currentPassword))) {
        return reply.code(400).send({ error: 'invalid_password' })
      }
      await db.user.update({
        where: { id: user.id },
        data: { passwordHash: await auth.hashPassword(input.newPassword) },
      })
      await auth.destroyAllSessions(user.id, req.session?.id)
      await audit.log({ userId: user.id, action: 'auth.password_changed', ip: req.ip })
      return { ok: true }
    },
  )

  // ── Two-factor authentication (NFR-06) ──

  app.post('/2fa/setup', { preHandler: requireAuth }, async (req, reply) => {
    const user = currentUser(req)
    if (user.totpSecret) return reply.code(409).send({ error: 'already_enabled' })
    const { secret, uri } = auth.newTotpSecret(user.email)
    await redis.set(pendingTotpKey(user.id), cipher.encrypt(secret), 'EX', 600)
    return { secret, uri }
  })

  app.post(
    '/2fa/enable',
    { preHandler: requireAuth, config: credentialLimit },
    async (req, reply) => {
      const { token } = totpTokenSchema.parse(req.body)
      const user = currentUser(req)
      const pending = await redis.get(pendingTotpKey(user.id))
      if (!pending) return reply.code(400).send({ error: 'setup_expired' })
      if (!(await auth.verifyTotp(pending, token))) {
        return reply.code(400).send({ error: 'invalid_totp' })
      }
      await db.user.update({ where: { id: user.id }, data: { totpSecret: pending } })
      await redis.del(pendingTotpKey(user.id))
      await audit.log({ userId: user.id, action: 'auth.2fa_enabled', ip: req.ip })
      return { ok: true }
    },
  )

  app.post(
    '/2fa/disable',
    { preHandler: requireAuth, config: credentialLimit },
    async (req, reply) => {
      const input = disable2faSchema.parse(req.body)
      const user = currentUser(req)
      if (!user.totpSecret) return reply.code(400).send({ error: 'not_enabled' })
      const ok =
        (await auth.verifyPassword(user.passwordHash, input.password)) &&
        (await auth.verifyTotp(user.totpSecret, input.token))
      if (!ok) return reply.code(400).send({ error: 'invalid_credentials' })
      await db.user.update({ where: { id: user.id }, data: { totpSecret: null } })
      await audit.log({ userId: user.id, action: 'auth.2fa_disabled', ip: req.ip })
      return { ok: true }
    },
  )

  // ── Invitations (FR-61) ──

  app.get('/invitations/:token', { config: credentialLimit }, async (req, reply) => {
    const { token } = req.params as { token: string }
    const invite = await db.invitation.findUnique({ where: { tokenHash: sha256(token) } })
    if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
      return reply.code(404).send({ error: 'invalid_invitation' })
    }
    return { email: invite.email, name: invite.name, role: invite.role }
  })

  app.post('/invitations/accept', { config: credentialLimit }, async (req, reply) => {
    const input = acceptInviteSchema.parse(req.body)
    const invite = await db.invitation.findUnique({ where: { tokenHash: sha256(input.token) } })
    if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
      return reply.code(404).send({ error: 'invalid_invitation' })
    }
    if (await db.user.findUnique({ where: { email: invite.email } })) {
      return reply.code(409).send({ error: 'email_taken' })
    }
    const passwordHash = await auth.hashPassword(input.password)
    const user = await db.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { name: invite.name, email: invite.email, role: invite.role, passwordHash },
      })
      const teams = await tx.team.findMany({
        where: { id: { in: invite.teamIds } },
        select: { id: true },
      })
      if (teams.length) {
        await tx.teamMember.createMany({
          data: teams.map((t) => ({ teamId: t.id, userId: created.id })),
        })
      }
      await tx.invitation.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } })
      return created
    })
    const session = await auth.createSession(user.id, {
      userAgent: req.headers['user-agent'],
      ip: req.ip,
    })
    setSessionCookie(reply, config, session.token, session.expiresAt)
    await audit.log({ userId: user.id, action: 'auth.invitation_accepted', ip: req.ip })
    return reply.code(201).send({ user: toPublicUser(user) })
  })
}
