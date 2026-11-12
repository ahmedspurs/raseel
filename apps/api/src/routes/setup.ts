import { type BusinessSettings, setupSchema } from '@raseel/shared'
import type { FastifyPluginAsync } from 'fastify'
import { setSessionCookie } from '../lib/http.js'
import { toPublicUser } from '../services/auth.js'
import { SettingKey } from '../services/settings.js'

/** Arbitrary constant used as a Postgres advisory lock so two setups cannot race. */
const SETUP_LOCK = 72_017

/** FR-01: first-run setup wizard. Only works while no users exist. */
export const setupRoutes: FastifyPluginAsync = async (app) => {
  const { db, settings, auth, audit, config } = app.ctx

  app.get('/status', async () => {
    const completedAt = await settings.get(SettingKey.SetupCompletedAt)
    const business = await settings.getJson<BusinessSettings>(SettingKey.Business)
    return {
      setupCompleted: completedAt !== null,
      business: business ? { name: business.name, language: business.language } : null,
    }
  })

  app.post(
    '/',
    { config: { rateLimit: { max: config.AUTH_RATE_LIMIT_MAX, timeWindow: '15 minutes' } } },
    async (req, reply) => {
      const input = setupSchema.parse(req.body)
      const passwordHash = await auth.hashPassword(input.owner.password)

      const owner = await db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SETUP_LOCK})`
        if ((await tx.user.count()) > 0) return null
        return tx.user.create({
          data: {
            name: input.owner.name,
            email: input.owner.email,
            passwordHash,
            role: 'OWNER',
            lastLoginAt: new Date(),
            language: input.business.language,
          },
        })
      })
      if (!owner) return reply.code(409).send({ error: 'already_setup' })

      const business: BusinessSettings = { ...input.business, logoUrl: null }
      await settings.setJson(SettingKey.Business, business)
      await settings.set(SettingKey.SetupCompletedAt, new Date().toISOString())

      const session = await auth.createSession(owner.id, {
        userAgent: req.headers['user-agent'],
        ip: req.ip,
      })
      setSessionCookie(reply, config, session.token, session.expiresAt)
      await audit.log({ userId: owner.id, action: 'setup.completed', ip: req.ip })

      return reply.code(201).send({ user: toPublicUser(owner) })
    },
  )
}
