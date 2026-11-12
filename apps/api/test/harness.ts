import type { FastifyInstance, LightMyRequestResponse } from 'fastify'
import { buildApp } from '../src/app.js'
import { closeContext, createContext } from '../src/bootstrap.js'
import { loadConfig } from '../src/config.js'
import type { AppContext } from '../src/context.js'
import { testEnv } from './env.js'

export interface Harness {
  app: FastifyInstance
  ctx: AppContext
  reset(): Promise<void>
  close(): Promise<void>
}

export async function createHarness(overrides: NodeJS.ProcessEnv = {}): Promise<Harness> {
  const ctx = createContext(loadConfig({ ...testEnv, ...overrides }))
  const app = await buildApp(ctx)
  await app.ready()
  return {
    app,
    ctx,
    async reset() {
      const tables = await ctx.db.$queryRaw<{ tablename: string }[]>`
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`
      const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ')
      if (list) await ctx.db.$executeRawUnsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`)
      ctx.settings.invalidate()
      await ctx.redis.flushdb()
    },
    async close() {
      await app.close()
      await closeContext(ctx)
    },
  }
}

/** Extracts the session cookie from a response so later requests can reuse it. */
export function sessionCookie(res: LightMyRequestResponse): string {
  const cookie = res.cookies.find((c) => c.name === 'raseel_session')
  if (!cookie) throw new Error(`no session cookie in response (status ${res.statusCode})`)
  return `raseel_session=${cookie.value}`
}

export const ownerSetup = {
  business: { name: 'Al Noor Clinic', language: 'ar', timeZone: 'Asia/Riyadh' },
  owner: { name: 'Huda', email: 'owner@example.com', password: 'owner-password-123' },
}

export async function setupOwner(h: Harness): Promise<string> {
  const res = await h.app.inject({ method: 'POST', url: '/api/setup', payload: ownerSetup })
  return sessionCookie(res)
}

/** Invites a user with the given role and accepts the invitation; returns their cookie. */
export async function createUser(
  h: Harness,
  inviterCookie: string,
  role: 'ADMIN' | 'AGENT' | 'VIEWER',
  email = `${role.toLowerCase()}@example.com`,
): Promise<string> {
  const invite = await h.app.inject({
    method: 'POST',
    url: '/api/users/invitations',
    headers: { cookie: inviterCookie },
    payload: { name: role, email, role },
  })
  const token = (invite.json() as { link: string }).link.split('/').pop()
  const res = await h.app.inject({
    method: 'POST',
    url: '/api/auth/invitations/accept',
    payload: { token, password: 'member-password-123' },
  })
  return sessionCookie(res)
}
