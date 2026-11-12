import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MockGraph } from '../src/dev/mock-graph.js'
import { jobId } from '../src/lib/queues.js'
import { fakeWamid, statusPayload } from '../src/whatsapp/fixtures.js'
import { parseWebhook } from '../src/whatsapp/parse.js'
import { createHarness, createUser, type Harness, setupOwner } from './harness.js'

let h: Harness
let mock: MockGraph
let owner: string
let templateId: string
let vipTag: string

beforeAll(async () => {
  mock = new MockGraph({ autoApproveTemplates: true })
  await mock.start()
  h = await createHarness({ WHATSAPP_GRAPH_URL: mock.url })
})
afterAll(async () => {
  await h.close()
  await mock.close()
})

const api = (method: string, url: string, payload?: unknown, cookie = owner) =>
  h.app.inject({ method: method as 'GET', url, headers: { cookie }, payload: payload as object })

async function contact(
  waId: string,
  name: string,
  opts: { optIn?: boolean; vip?: boolean; city?: string } = {},
) {
  const c = (await api('POST', '/api/contacts', { waId, name })).json().contact
  await api('PATCH', `/api/contacts/${c.id}`, {
    optInMarketing: opts.optIn ?? false,
    tagIds: opts.vip ? [vipTag] : [],
    ...(opts.city ? { customFields: { city: opts.city } } : {}),
  })
  return c.id as string
}

beforeEach(async () => {
  await h.reset()
  mock.templates.length = 0
  mock.sent.length = 0
  owner = await setupOwner(h)
  await api('PUT', '/api/whatsapp/settings', {
    phoneNumberId: mock.phoneNumberId,
    wabaId: mock.wabaId,
    accessToken: mock.accessToken,
    appSecret: 'ef'.repeat(16),
  })
  await api('POST', '/api/templates', {
    name: 'eid_offer',
    language: 'ar',
    category: 'MARKETING',
    body: 'عيد مبارك {{1}}! خصم 20% على جميع الخدمات هذا الأسبوع.',
    bodyExamples: ['سارة'],
  })
  templateId = (await h.ctx.db.template.findFirstOrThrow()).id
  vipTag = (await api('POST', '/api/tags', { name: 'VIP' })).json().tag.id
  await api('POST', '/api/custom-fields', { key: 'city', label: 'City', type: 'TEXT' })
})

const vipSegment = async () =>
  (await api('POST', '/api/segments', { name: 'VIP', filter: { tagIds: [vipTag] } })).json().segment
    .id as string

describe('segments (FR-35)', () => {
  it('counts only opted-in contacts as the audience', async () => {
    await contact('966500000201', 'A', { optIn: true, vip: true })
    await contact('966500000202', 'B', { optIn: false, vip: true })
    await contact('966500000203', 'C', { optIn: true, vip: false, city: 'جدة' })

    const preview = await api('POST', '/api/segments/preview', { filter: { tagIds: [vipTag] } })
    expect(preview.json()).toEqual({ audience: 1, matching: 2 })

    const byCity = await api('POST', '/api/segments/preview', {
      filter: { fields: { city: 'جدة' } },
    })
    expect(byCity.json()).toEqual({ audience: 1, matching: 1 })
  })
})

describe('broadcasts (FR-42, FR-43)', () => {
  it('sends to opted-in segment members only and reports delivery and replies', async () => {
    const a = await contact('966500000211', 'سارة القحطاني', { optIn: true, vip: true })
    await contact('966500000212', 'Not opted in', { optIn: false, vip: true })
    await contact('966500000213', 'Not VIP', { optIn: true })

    const segmentId = await vipSegment()
    const res = await api('POST', '/api/broadcasts', {
      name: 'Eid campaign',
      templateId,
      segmentId,
      variables: [{ field: 'contact.firstName' }],
    })
    expect(res.statusCode).toBe(201)
    const id = res.json().broadcast.id
    expect(await h.ctx.queues.broadcast.getJob(jobId('broadcast-start', id))).toBeTruthy()

    expect(await h.ctx.broadcasts.start(id)).toBe(1)
    const recipient = await h.ctx.db.broadcastRecipient.findFirstOrThrow()
    expect(await h.ctx.broadcasts.sendOne(recipient.id, { finalAttempt: false })).toBe('sent')

    expect(mock.sent).toHaveLength(1)
    expect(mock.sent[0]).toMatchObject({ to: '966500000211', type: 'template' })
    const broadcast = await h.ctx.db.broadcast.findUniqueOrThrow({ where: { id } })
    expect(broadcast.status).toBe('COMPLETED')

    // Delivery receipts and a reply flow into the report.
    const message = await h.ctx.db.message.findFirstOrThrow({ where: { type: 'TEMPLATE' } })
    for (const s of parseWebhook(
      statusPayload(mock.phoneNumberId, message.waMessageId!, '966500000211', 'read'),
      mock.phoneNumberId,
    ).statuses) {
      await h.ctx.inbound.handleStatus(s)
    }
    await h.ctx.inbound.handleMessage({
      waMessageId: fakeWamid(),
      from: '966500000211',
      profileName: null,
      timestamp: new Date(Date.now() + 1000),
      type: 'TEXT',
      body: 'شكراً، أبغى أحجز',
      payload: null,
      media: null,
      replyToWaId: null,
    })
    const report = await api('GET', `/api/broadcasts/${id}`)
    expect(report.json().stats).toMatchObject({
      total: 1,
      sent: 1,
      delivered: 1,
      read: 1,
      replied: 1,
      failed: 0,
    })
    expect(report.json().recipients[0].contact.id).toBe(a)
  })

  it('skips contacts who opted out after the broadcast was created (FR-44)', async () => {
    const id1 = await contact('966500000221', 'A', { optIn: true, vip: true })
    await contact('966500000222', 'B', { optIn: true, vip: true })
    const segmentId = await vipSegment()
    const id = (
      await api('POST', '/api/broadcasts', {
        name: 'x',
        templateId,
        segmentId,
        variables: [{ value: 'صديقنا' }],
      })
    ).json().broadcast.id
    await h.ctx.broadcasts.start(id)

    await api('PATCH', `/api/contacts/${id1}`, { optInMarketing: false })
    for (const r of await h.ctx.db.broadcastRecipient.findMany()) {
      await h.ctx.broadcasts.sendOne(r.id, { finalAttempt: false })
    }
    expect(mock.sent).toHaveLength(1)
    const skipped = await h.ctx.db.broadcastRecipient.findFirstOrThrow({
      where: { contactId: id1 },
    })
    expect(skipped).toMatchObject({ status: 'SKIPPED', error: 'opted_out' })
  })

  it('does not reopen closed conversations or retry-duplicate messages', async () => {
    const cid = await contact('966500000231', 'A', { optIn: true, vip: true })
    const conv = await h.ctx.db.conversation.create({
      data: { contactId: cid, status: 'CLOSED', closedAt: new Date() },
    })
    const segmentId = await vipSegment()
    const id = (
      await api('POST', '/api/broadcasts', {
        name: 'x',
        templateId,
        segmentId,
        variables: [{ value: 'x' }],
      })
    ).json().broadcast.id
    await h.ctx.broadcasts.start(id)
    const r = await h.ctx.db.broadcastRecipient.findFirstOrThrow()

    mock.failNext({ code: 130429, message: 'Rate limit hit' })
    await expect(h.ctx.broadcasts.sendOne(r.id, { finalAttempt: false })).rejects.toThrow()
    await h.ctx.broadcasts.sendOne(r.id, { finalAttempt: false })

    expect(await h.ctx.db.message.count({ where: { type: 'TEMPLATE' } })).toBe(1)
    expect(mock.sent).toHaveLength(1)
    expect((await h.ctx.db.conversation.findUniqueOrThrow({ where: { id: conv.id } })).status).toBe(
      'CLOSED',
    )
  })

  it('schedules for later and can be cancelled', async () => {
    await contact('966500000241', 'A', { optIn: true, vip: true })
    const segmentId = await vipSegment()
    const at = new Date(Date.now() + 3600_000).toISOString()
    const id = (
      await api('POST', '/api/broadcasts', {
        name: 'Later',
        templateId,
        segmentId,
        variables: [{ value: 'x' }],
        scheduledAt: at,
      })
    ).json().broadcast.id
    const job = await h.ctx.queues.broadcast.getJob(jobId('broadcast-start', id))
    expect(job?.opts.delay).toBeGreaterThan(3500_000)

    expect((await api('POST', `/api/broadcasts/${id}/cancel`)).statusCode).toBe(200)
    expect((await h.ctx.db.broadcast.findUniqueOrThrow({ where: { id } })).status).toBe('CANCELLED')
    expect(await h.ctx.queues.broadcast.getJob(jobId('broadcast-start', id))).toBeFalsy()
    expect(await h.ctx.broadcasts.start(id)).toBe(0)
  })

  it('refuses empty audiences, unapproved templates and agents', async () => {
    const segmentId = await vipSegment()
    const empty = await api('POST', '/api/broadcasts', {
      name: 'x',
      templateId,
      segmentId,
      variables: [],
    })
    expect(empty.json().error).toBe('empty_audience')

    await h.ctx.db.template.update({ where: { id: templateId }, data: { status: 'PENDING' } })
    await contact('966500000251', 'A', { optIn: true, vip: true })
    const pending = await api('POST', '/api/broadcasts', {
      name: 'x',
      templateId,
      segmentId,
      variables: [],
    })
    expect(pending.json().error).toBe('template_not_approved')

    const agent = await createUser(h, owner, 'AGENT')
    expect(
      (
        await api(
          'POST',
          '/api/broadcasts',
          { name: 'x', templateId, segmentId, variables: [] },
          agent,
        )
      ).statusCode,
    ).toBe(403)
  })
})
