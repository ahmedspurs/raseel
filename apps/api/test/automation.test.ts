import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { MockGraph } from '../src/dev/mock-graph.js'
import { fakeWamid } from '../src/whatsapp/fixtures.js'
import { createHarness, createUser, type Harness, setupOwner } from './harness.js'

let h: Harness
let mock: MockGraph
let owner: string

beforeAll(async () => {
  mock = new MockGraph()
  await mock.start()
  h = await createHarness({ WHATSAPP_GRAPH_URL: mock.url })
})
afterAll(async () => {
  vi.useRealTimers()
  await h.close()
  await mock.close()
})
beforeEach(async () => {
  vi.useRealTimers()
  await h.reset()
  mock.sent.length = 0
  owner = await setupOwner(h)
  await h.app.inject({
    method: 'PUT',
    url: '/api/whatsapp/settings',
    headers: { cookie: owner },
    payload: {
      phoneNumberId: mock.phoneNumberId,
      wabaId: mock.wabaId,
      accessToken: mock.accessToken,
      appSecret: 'cd'.repeat(16),
    },
  })
})

const api = (method: string, url: string, payload?: unknown, cookie = owner) =>
  h.app.inject({ method: method as 'GET', url, headers: { cookie }, payload: payload as object })

const say = (from: string, body: string) =>
  h.ctx.inbound.handleMessage({
    waMessageId: fakeWamid(),
    from,
    profileName: 'Customer',
    timestamp: new Date(),
    type: 'TEXT',
    body,
    payload: null,
    media: null,
    replyToWaId: null,
  })

const automated = () =>
  h.ctx.db.message.findMany({ where: { automated: true }, orderBy: { createdAt: 'asc' } })

const closedAllWeek = Array.from({ length: 7 }, () => ({
  open: false,
  start: '09:00',
  end: '17:00',
}))
const openAllDay = Array.from({ length: 7 }, () => ({ open: true, start: '00:00', end: '23:59' }))

describe('opt-out (FR-44)', () => {
  it('withdraws marketing consent when the customer replies STOP or إيقاف', async () => {
    await say('966500000101', 'hello')
    const contact = await h.ctx.db.contact.findFirstOrThrow()
    await h.ctx.db.contact.update({ where: { id: contact.id }, data: { optInMarketing: true } })

    await say('966500000101', 'إيقاف')
    const after = await h.ctx.db.contact.findUniqueOrThrow({ where: { id: contact.id } })
    expect(after.optInMarketing).toBe(false)
    expect(after.optedOutAt).toBeTruthy()
    expect(await h.ctx.db.auditLog.count({ where: { action: 'contact.opted_out' } })).toBe(1)
  })
})

describe('welcome message (FR-51)', () => {
  it('greets first-time contacts once, with reply buttons', async () => {
    await api('PUT', '/api/automation/settings', {
      workingHours: { enabled: false, days: openAllDay, awayMessage: '' },
      welcome: {
        enabled: true,
        message: 'أهلاً بك في عيادة النور! كيف نخدمك؟',
        buttons: ['حجز موعد', 'الأسعار'],
      },
    })
    await say('966500000102', 'السلام عليكم')
    await say('966500000102', 'موجود؟')

    const msgs = await automated()
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toMatchObject({
      type: 'INTERACTIVE',
      body: 'أهلاً بك في عيادة النور! كيف نخدمك؟',
    })

    await h.ctx.outbound.send(msgs[0]!.id, { finalAttempt: false })
    expect(mock.sent[0]).toMatchObject({
      type: 'interactive',
      body: {
        interactive: {
          type: 'button',
          action: {
            buttons: [
              { type: 'reply', reply: { id: 'btn_1', title: 'حجز موعد' } },
              { type: 'reply', reply: { id: 'btn_2', title: 'الأسعار' } },
            ],
          },
        },
      },
    })
  })
})

describe('away message (FR-50)', () => {
  it('replies outside working hours at most once per conversation', async () => {
    await api('PUT', '/api/automation/settings', {
      workingHours: {
        enabled: true,
        days: closedAllWeek,
        awayMessage: 'نحن خارج أوقات الدوام، سنرد عليك قريباً.',
      },
      welcome: { enabled: false, message: '', buttons: [] },
    })
    await say('966500000103', 'hi')
    await say('966500000103', 'anyone?')
    const msgs = await automated()
    expect(msgs.map((m) => m.body)).toEqual(['نحن خارج أوقات الدوام، سنرد عليك قريباً.'])
  })

  it('stays quiet during working hours', async () => {
    await api('PUT', '/api/automation/settings', {
      workingHours: { enabled: true, days: openAllDay, awayMessage: 'closed' },
      welcome: { enabled: false, message: '', buttons: [] },
    })
    await say('966500000104', 'hi')
    expect(await automated()).toHaveLength(0)
  })

  it('validates working hours', async () => {
    const res = await api('PUT', '/api/automation/settings', {
      workingHours: { enabled: true, days: openAllDay.slice(0, 3), awayMessage: '' },
      welcome: { enabled: false, message: '', buttons: [] },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('keyword rules (FR-52)', () => {
  it('tags, assigns and replies when a message matches', async () => {
    await createUser(h, owner, 'AGENT')
    const agentId = (
      await h.ctx.db.user.findUniqueOrThrow({ where: { email: 'agent@example.com' } })
    ).id
    const tag = (await api('POST', '/api/tags', { name: 'استفسار سعر' })).json().tag

    const rule = await api('POST', '/api/automation/rules', {
      name: 'Pricing',
      keywords: ['سعر', 'price'],
      actions: {
        tagId: tag.id,
        assigneeId: agentId,
        reply: 'قائمة الأسعار: https://example.com/prices',
      },
    })
    expect(rule.statusCode).toBe(201)

    await say('966500000105', 'كم سعر الكشف عندكم؟')
    const conv = await h.ctx.db.conversation.findFirstOrThrow({
      include: { contact: { include: { tags: true } } },
    })
    expect(conv.assigneeId).toBe(agentId)
    expect(conv.contact.tags.map((t) => t.tagId)).toEqual([tag.id])
    expect((await automated()).map((m) => m.body)).toEqual([
      'قائمة الأسعار: https://example.com/prices',
    ])
  })

  it('ignores inactive rules and non-matching messages', async () => {
    await api('POST', '/api/automation/rules', {
      name: 'Off',
      keywords: ['موقع'],
      actions: { reply: 'x' },
      active: false,
    })
    await say('966500000106', 'وين موقعكم')
    await say('966500000106', 'شكراً')
    expect(await automated()).toHaveLength(0)
  })

  it('is managed by admins only', async () => {
    const agent = await createUser(h, owner, 'AGENT')
    const res = await api(
      'POST',
      '/api/automation/rules',
      { name: 'x', keywords: ['a'], actions: { reply: 'b' } },
      agent,
    )
    expect(res.statusCode).toBe(403)
  })
})
