import { generate } from 'otplib'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  createHarness,
  createUser,
  type Harness,
  ownerSetup,
  sessionCookie,
  setupOwner,
} from './harness.js'

let h: Harness

beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => {
  await h.close()
})
beforeEach(async () => {
  await h.reset()
})

describe('health', () => {
  it('reports database and redis readiness', async () => {
    const res = await h.app.inject({ method: 'GET', url: '/health/ready' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok', database: 'ok', redis: 'ok' })
  })
})

describe('setup wizard (FR-01)', () => {
  it('creates the owner once and signs them in', async () => {
    const before = await h.app.inject({ method: 'GET', url: '/api/setup/status' })
    expect(before.json()).toMatchObject({ setupCompleted: false })

    const res = await h.app.inject({ method: 'POST', url: '/api/setup', payload: ownerSetup })
    expect(res.statusCode).toBe(201)
    expect(res.json().user).toMatchObject({ role: 'OWNER', email: 'owner@example.com' })
    expect(res.json().user).not.toHaveProperty('passwordHash')

    const me = await h.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: sessionCookie(res) },
    })
    expect(me.statusCode).toBe(200)

    const after = await h.app.inject({ method: 'GET', url: '/api/setup/status' })
    expect(after.json()).toMatchObject({
      setupCompleted: true,
      business: { name: 'Al Noor Clinic' },
    })
  })

  it('refuses a second setup', async () => {
    await setupOwner(h)
    const again = await h.app.inject({ method: 'POST', url: '/api/setup', payload: ownerSetup })
    expect(again.statusCode).toBe(409)
  })

  it('handles concurrent setup requests safely', async () => {
    const results = await Promise.all(
      [0, 1, 2].map((i) =>
        h.app.inject({
          method: 'POST',
          url: '/api/setup',
          payload: { ...ownerSetup, owner: { ...ownerSetup.owner, email: `o${i}@example.com` } },
        }),
      ),
    )
    expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1)
    expect(await h.ctx.db.user.count()).toBe(1)
  })

  it('validates input', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/setup',
      payload: { ...ownerSetup, owner: { ...ownerSetup.owner, password: 'short' } },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('validation_error')
  })
})

describe('login and sessions', () => {
  it('rejects wrong passwords and accepts the right one', async () => {
    await setupOwner(h)
    const bad = await h.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'owner@example.com', password: 'wrong-password' },
    })
    expect(bad.statusCode).toBe(401)

    const good = await h.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'OWNER@example.com', password: ownerSetup.owner.password },
    })
    expect(good.statusCode).toBe(200)
    const cookie = good.cookies.find((c) => c.name === 'raseel_session')
    expect(cookie?.httpOnly).toBe(true)
    expect(cookie?.sameSite).toBe('Lax')

    const logs = await h.ctx.db.auditLog.findMany({ select: { action: true } })
    expect(logs.map((l) => l.action)).toEqual(
      expect.arrayContaining(['auth.login_failed', 'auth.login']),
    )
  })

  it('invalidates the session on logout', async () => {
    const cookie = await setupOwner(h)
    await h.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } })
    const me = await h.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })
    expect(me.statusCode).toBe(401)
  })

  it('rejects tampered cookies', async () => {
    const me = await h.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: 'raseel_session=forged.value' },
    })
    expect(me.statusCode).toBe(401)
  })

  it('blocks cross-origin writes', async () => {
    const cookie = await setupOwner(h)
    const res = await h.app.inject({
      method: 'PATCH',
      url: '/api/auth/me',
      headers: { cookie, origin: 'https://evil.example' },
      payload: { language: 'en' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('updates the interface language (FR-64)', async () => {
    const cookie = await setupOwner(h)
    const res = await h.app.inject({
      method: 'PATCH',
      url: '/api/auth/me',
      headers: { cookie, origin: 'http://localhost:3000' },
      payload: { language: 'en' },
    })
    expect(res.json().user.language).toBe('en')
  })
})

describe('roles and invitations (FR-61, NFR-09)', () => {
  it('lets an invited agent sign in but not manage users', async () => {
    const owner = await setupOwner(h)
    const agent = await createUser(h, owner, 'AGENT')

    const me = await h.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: agent },
    })
    expect(me.json().user.role).toBe('AGENT')

    const invite = await h.app.inject({
      method: 'POST',
      url: '/api/users/invitations',
      headers: { cookie: agent },
      payload: { name: 'X', email: 'x@example.com', role: 'VIEWER' },
    })
    expect(invite.statusCode).toBe(403)
  })

  it('prevents admins from creating other admins', async () => {
    const owner = await setupOwner(h)
    const admin = await createUser(h, owner, 'ADMIN')
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/users/invitations',
      headers: { cookie: admin },
      payload: { name: 'Y', email: 'y@example.com', role: 'ADMIN' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('logs out a user immediately when deactivated', async () => {
    const owner = await setupOwner(h)
    const agent = await createUser(h, owner, 'AGENT')
    const agentUser = await h.ctx.db.user.findUniqueOrThrow({
      where: { email: 'agent@example.com' },
    })

    const res = await h.app.inject({
      method: 'PATCH',
      url: `/api/users/${agentUser.id}`,
      headers: { cookie: owner },
      payload: { active: false },
    })
    expect(res.statusCode).toBe(200)
    const me = await h.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { cookie: agent },
    })
    expect(me.statusCode).toBe(401)
  })

  it('does not allow an invitation to be used twice', async () => {
    const owner = await setupOwner(h)
    const invite = await h.app.inject({
      method: 'POST',
      url: '/api/users/invitations',
      headers: { cookie: owner },
      payload: { name: 'Z', email: 'z@example.com', role: 'AGENT' },
    })
    const token = invite.json().link.split('/').pop()
    const accept = () =>
      h.app.inject({
        method: 'POST',
        url: '/api/auth/invitations/accept',
        payload: { token, password: 'member-password-123' },
      })
    expect((await accept()).statusCode).toBe(201)
    expect((await accept()).statusCode).toBe(404)
  })
})

describe('two-factor authentication (NFR-06)', () => {
  it('requires a TOTP code after enabling 2FA', async () => {
    const cookie = await setupOwner(h)
    const setup = await h.app.inject({
      method: 'POST',
      url: '/api/auth/2fa/setup',
      headers: { cookie },
    })
    const { secret } = setup.json()
    const enable = await h.app.inject({
      method: 'POST',
      url: '/api/auth/2fa/enable',
      headers: { cookie },
      payload: { token: await generate({ secret }) },
    })
    expect(enable.statusCode).toBe(200)

    const stored = await h.ctx.db.user.findUniqueOrThrow({ where: { email: 'owner@example.com' } })
    expect(stored.totpSecret).not.toContain(secret)

    const creds = { email: 'owner@example.com', password: ownerSetup.owner.password }
    const without = await h.app.inject({ method: 'POST', url: '/api/auth/login', payload: creds })
    expect(without.json().error).toBe('totp_required')

    const withCode = await h.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { ...creds, totp: await generate({ secret }) },
    })
    expect(withCode.statusCode).toBe(200)
  })
})

describe('rate limiting (NFR-09)', () => {
  it('locks out repeated login attempts', async () => {
    const limited = await createHarness({ AUTH_RATE_LIMIT_MAX: '3' })
    try {
      const attempt = () =>
        limited.app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { email: 'nobody@example.com', password: 'guess' },
        })
      const codes = []
      for (let i = 0; i < 4; i++) codes.push((await attempt()).statusCode)
      expect(codes).toEqual([401, 401, 401, 429])
    } finally {
      await limited.close()
    }
  })
})

describe('teams', () => {
  it('creates teams and ignores unknown member ids', async () => {
    const owner = await setupOwner(h)
    const ownerUser = await h.ctx.db.user.findFirstOrThrow()
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/teams',
      headers: { cookie: owner },
      payload: { name: 'Sales · المبيعات', memberIds: [ownerUser.id, 'missing-user'] },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().team.memberIds).toEqual([ownerUser.id])

    const dup = await h.app.inject({
      method: 'POST',
      url: '/api/teams',
      headers: { cookie: owner },
      payload: { name: 'Sales · المبيعات' },
    })
    expect(dup.statusCode).toBe(409)
  })
})
