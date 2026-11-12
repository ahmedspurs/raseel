import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { fakeWamid } from '../src/whatsapp/fixtures.js'
import type { InboundMessage } from '../src/whatsapp/parse.js'
import { createHarness, createUser, type Harness, setupOwner } from './harness.js'

let h: Harness
let owner: string

beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => {
  await h.close()
})
beforeEach(async () => {
  await h.reset()
  owner = await setupOwner(h)
})

/** Simulates a customer message without going through the webhook. */
async function customer(from: string, body = 'hello', at = new Date()) {
  const m: InboundMessage = {
    waMessageId: fakeWamid(),
    from,
    profileName: `Customer ${from.slice(-2)}`,
    timestamp: at,
    type: 'TEXT',
    body,
    payload: null,
    media: null,
    replyToWaId: null,
  }
  await h.ctx.inbound.handleMessage(m)
  return h.ctx.db.conversation.findFirstOrThrow({ where: { contact: { waId: from } } })
}

const userId = (email: string) =>
  h.ctx.db.user.findUniqueOrThrow({ where: { email } }).then((u) => u.id)

const list = (cookie: string, query: string) =>
  h.app
    .inject({ method: 'GET', url: `/api/conversations?${query}`, headers: { cookie } })
    .then((r) => r.json().conversations.map((c: { id: string }) => c.id) as string[])

const patch = (cookie: string, id: string, payload: unknown) =>
  h.app.inject({ method: 'PATCH', url: `/api/conversations/${id}`, headers: { cookie }, payload })

describe('inbox views (FR-14)', () => {
  it('splits conversations into mine, unassigned, team, all and closed', async () => {
    const agent = await createUser(h, owner, 'AGENT')
    const agentId = await userId('agent@example.com')
    const team = await h.app.inject({
      method: 'POST',
      url: '/api/teams',
      headers: { cookie: owner },
      payload: { name: 'Support', memberIds: [agentId] },
    })
    const teamId = team.json().team.id

    const a = await customer('966500000001')
    const b = await customer('966500000002')
    const c = await customer('966500000003')
    const d = await customer('966500000004')
    await patch(owner, a.id, { assigneeId: agentId })
    await patch(owner, b.id, { teamId })
    await patch(owner, d.id, { status: 'CLOSED' })

    expect(await list(agent, 'view=mine')).toEqual([a.id])
    expect((await list(agent, 'view=unassigned')).sort()).toEqual([b.id, c.id].sort())
    expect(await list(agent, 'view=team')).toEqual([b.id])
    expect((await list(agent, 'view=all')).sort()).toEqual([a.id, b.id, c.id].sort())
    expect(await list(agent, 'view=closed')).toEqual([d.id])

    const counts = await h.app.inject({
      method: 'GET',
      url: '/api/conversations/counts',
      headers: { cookie: agent },
    })
    expect(counts.json().counts).toMatchObject({ mine: 1, unassigned: 2, team: 1, all: 3 })
  })

  it('filters by agent, status and date', async () => {
    const agentId = (await createUser(h, owner, 'AGENT'), await userId('agent@example.com'))
    const old = await customer('966500000010', 'old', new Date('2026-01-05T10:00:00Z'))
    const recent = await customer('966500000011', 'recent')
    await patch(owner, recent.id, { assigneeId: agentId, status: 'PENDING' })

    expect(await list(owner, `view=all&assigneeId=${agentId}`)).toEqual([recent.id])
    expect(await list(owner, 'view=all&status=PENDING')).toEqual([recent.id])
    expect(await list(owner, 'view=all&from=2026-01-01&to=2026-01-31')).toEqual([old.id])
  })
})

describe('assignment and status (FR-15, FR-16, FR-62)', () => {
  it('assigns, records the audit trail and closes', async () => {
    await createUser(h, owner, 'AGENT')
    const agentId = await userId('agent@example.com')
    const conv = await customer('966500000020')

    const res = await patch(owner, conv.id, { assigneeId: agentId })
    expect(res.statusCode).toBe(200)
    expect(res.json().conversation.assigneeId).toBe(agentId)

    const closed = await patch(owner, conv.id, { status: 'CLOSED' })
    expect(closed.json().conversation.status).toBe('CLOSED')
    const row = await h.ctx.db.conversation.findUniqueOrThrow({ where: { id: conv.id } })
    expect(row.closedAt).toBeTruthy()

    const actions = (await h.ctx.db.auditLog.findMany({ where: { target: conv.id } })).map(
      (l) => l.action,
    )
    expect(actions).toEqual(
      expect.arrayContaining(['conversation.assigned', 'conversation.status_changed']),
    )
  })

  it('refuses viewers and inactive or read-only assignees', async () => {
    const viewer = await createUser(h, owner, 'VIEWER')
    const viewerId = await userId('viewer@example.com')
    const conv = await customer('966500000021')

    expect((await patch(viewer, conv.id, { status: 'CLOSED' })).statusCode).toBe(403)
    const bad = await patch(owner, conv.id, { assigneeId: viewerId })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().error).toBe('invalid_assignee')
  })

  it('round-robins new conversations across agents when enabled', async () => {
    await createUser(h, owner, 'AGENT', 'a1@example.com')
    await createUser(h, owner, 'AGENT', 'a2@example.com')
    const [a1, a2] = [await userId('a1@example.com'), await userId('a2@example.com')]

    // Off by default.
    expect((await customer('966500000030')).assigneeId).toBeNull()

    const save = await h.app.inject({
      method: 'PUT',
      url: '/api/settings/inbox',
      headers: { cookie: owner },
      payload: { autoAssign: { enabled: true, userIds: [] } },
    })
    expect(save.statusCode).toBe(200)

    const assignees = [
      (await customer('966500000031')).assigneeId,
      (await customer('966500000032')).assigneeId,
      (await customer('966500000033')).assigneeId,
    ]
    expect(new Set(assignees)).toEqual(new Set([a1, a2]))
    expect(assignees[0]).not.toBe(assignees[1])
    expect(assignees[2]).toBe(assignees[0])
  })

  it('never reassigns a conversation that already has an agent', async () => {
    await createUser(h, owner, 'AGENT', 'a1@example.com')
    await createUser(h, owner, 'AGENT', 'a2@example.com')
    const a2 = await userId('a2@example.com')
    const conv = await customer('966500000040')
    await patch(owner, conv.id, { assigneeId: a2 })
    await h.ctx.assignment.saveInboxSettings({ autoAssign: { enabled: true, userIds: [] } })

    await customer('966500000040', 'follow-up')
    expect(
      (await h.ctx.db.conversation.findUniqueOrThrow({ where: { id: conv.id } })).assigneeId,
    ).toBe(a2)
  })
})
