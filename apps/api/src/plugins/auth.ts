import { can, type Permission } from '@raseel/shared'
import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify'
import fp from 'fastify-plugin'
import type { Session, User } from '../lib/db.js'
import { SESSION_COOKIE } from '../services/auth.js'

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null
    session: Session | null
  }
}

/**
 * Loads the session from the HTTP-only cookie on every request and
 * exposes `requireAuth` / `requirePermission` guards (NFR-06, NFR-09).
 */
export const authPlugin = fp(async (app) => {
  app.decorateRequest('user', null)
  app.decorateRequest('session', null)

  app.addHook('onRequest', async (req) => {
    const raw = req.cookies[SESSION_COOKIE]
    if (!raw) return
    const unsigned = req.unsignCookie(raw)
    if (!unsigned.valid || !unsigned.value) return
    const session = await app.ctx.auth.resolveSession(unsigned.value)
    if (!session) return
    const { user, ...rest } = session
    req.user = user
    req.session = rest
  })
})

export const requireAuth: preHandlerAsyncHookHandler = async (req, reply) => {
  if (!req.user) return reply.code(401).send({ error: 'unauthorized' })
}

export function requirePermission(permission: Permission): preHandlerAsyncHookHandler {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) return reply.code(401).send({ error: 'unauthorized' })
    if (!can(req.user.role, permission)) return reply.code(403).send({ error: 'forbidden' })
  }
}

/** Narrowing helper for handlers behind requireAuth. */
export function currentUser(req: FastifyRequest): User {
  if (!req.user) throw new Error('currentUser() used on an unauthenticated route')
  return req.user
}
