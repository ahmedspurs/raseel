import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import multipart from '@fastify/multipart'
import rateLimit from '@fastify/rate-limit'
import sensible from '@fastify/sensible'
import Fastify, { type FastifyServerOptions } from 'fastify'
import { ZodError } from 'zod'
import type { AppContext } from './context.js'
import { authPlugin } from './plugins/auth.js'
import { authRoutes } from './routes/auth.js'
import { conversationRoutes, mediaRoutes } from './routes/conversations.js'
import { healthRoutes } from './routes/health.js'
import { noteRoutes } from './routes/notes.js'
import { settingsRoutes } from './routes/settings.js'
import { setupRoutes } from './routes/setup.js'
import { teamRoutes } from './routes/teams.js'
import { userRoutes } from './routes/users.js'
import { webhookRoutes } from './routes/webhooks.js'
import { whatsappRoutes } from './routes/whatsapp.js'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export async function buildApp(ctx: AppContext, opts: FastifyServerOptions = {}) {
  const app = Fastify({
    logger: {
      level: ctx.config.LOG_LEVEL,
      // Never log credentials (NFR-08).
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
    },
    trustProxy: ctx.config.TRUST_PROXY,
    bodyLimit: 2 * 1024 * 1024,
    ...opts,
  })

  app.decorate('ctx', ctx)

  await app.register(sensible)
  await app.register(helmet, { contentSecurityPolicy: false })
  await app.register(cors, { origin: ctx.config.APP_URL, credentials: true })
  await app.register(cookie, { secret: ctx.config.SESSION_SECRET })
  await app.register(multipart, {
    limits: { files: 1, fields: 10, fileSize: ctx.config.MEDIA_MAX_MB * 1024 * 1024 },
  })
  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    redis: ctx.config.NODE_ENV === 'test' ? undefined : ctx.redis,
    nameSpace: 'raseel:rl:',
  })

  // CSRF defence: cookie-authenticated writes must come from our own origin.
  const appOrigin = new URL(ctx.config.APP_URL).origin
  app.addHook('onRequest', async (req, reply) => {
    if (SAFE_METHODS.has(req.method) || !req.url.startsWith('/api/')) return
    const origin =
      req.headers.origin ?? (req.headers.referer && new URL(req.headers.referer).origin)
    if (origin && origin !== appOrigin) {
      return reply.code(403).send({ error: 'bad_origin' })
    }
  })

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: 'validation_error',
        issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      })
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500
    if (status >= 500) req.log.error(err)
    return reply
      .code(status)
      .send({ error: status >= 500 ? 'internal_error' : (err as Error).message })
  })

  await app.register(authPlugin)
  await app.register(healthRoutes)
  await app.register(setupRoutes, { prefix: '/api/setup' })
  await app.register(authRoutes, { prefix: '/api/auth' })
  await app.register(userRoutes, { prefix: '/api/users' })
  await app.register(teamRoutes, { prefix: '/api/teams' })
  await app.register(settingsRoutes, { prefix: '/api/settings' })
  await app.register(whatsappRoutes, { prefix: '/api/whatsapp' })
  await app.register(conversationRoutes, { prefix: '/api/conversations' })
  await app.register(mediaRoutes, { prefix: '/api/media' })
  await app.register(noteRoutes, { prefix: '/api' })
  await app.register(webhookRoutes, { prefix: '/webhooks' })

  return app
}
