import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MockGraph } from '../src/dev/mock-graph.js'
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
  await h.close()
  await mock.close()
})
beforeEach(async () => {
  await h.reset()
  mock.templates.length = 0
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
      appSecret: 'ab'.repeat(16),
    },
  })
})

const api = (method: string, url: string, payload?: unknown, cookie = owner) =>
  h.app.inject({ method: method as 'GET', url, headers: { cookie }, payload: payload as object })

const orderTemplate = {
  name: 'order_ready',
  language: 'ar',
  category: 'UTILITY',
  header: { text: 'طلبك جاهز' },
  body: 'مرحبا {{1}}، طلبك رقم {{2}} جاهز للاستلام من فرع {{3}}.',
  bodyExamples: ['سارة', '1042', 'العليا'],
  footer: 'رسيل',
  buttons: [{ type: 'QUICK_REPLY', text: 'شكراً' }],
}

describe('templates (FR-40)', () => {
  it('submits a template to Meta in its component format', async () => {
    const res = await api('POST', '/api/templates', orderTemplate)
    expect(res.statusCode).toBe(201)
    expect(res.json().template).toMatchObject({ name: 'order_ready', status: 'PENDING' })

    const submitted = mock.templates[0]!
    expect(submitted.components).toEqual([
      { type: 'HEADER', format: 'TEXT', text: 'طلبك جاهز' },
      {
        type: 'BODY',
        text: orderTemplate.body,
        example: { body_text: [['سارة', '1042', 'العليا']] },
      },
      { type: 'FOOTER', text: 'رسيل' },
      { type: 'BUTTONS', buttons: [{ type: 'QUICK_REPLY', text: 'شكراً' }] },
    ])
  })

  it('requires an example for every body variable', async () => {
    const res = await api('POST', '/api/templates', { ...orderTemplate, bodyExamples: ['سارة'] })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('missing_variables')
  })

  it('syncs statuses and removes templates deleted in Meta', async () => {
    await api('POST', '/api/templates', orderTemplate)
    mock.templates[0]!.status = 'APPROVED'
    mock.templates.push({
      id: 'other',
      name: 'welcome',
      language: 'en_US',
      category: 'MARKETING',
      status: 'REJECTED',
      components: [{ type: 'BODY', text: 'Hi' }],
    })
    const sync = await api('POST', '/api/templates/sync')
    expect(sync.json()).toEqual({ total: 2, approved: 1 })

    mock.templates.splice(1, 1)
    await api('POST', '/api/templates/sync')
    const list = (await api('GET', '/api/templates')).json().templates
    expect(list.map((t: { name: string; status: string }) => [t.name, t.status])).toEqual([
      ['order_ready', 'APPROVED'],
    ])
  })

  it('is managed by admins only', async () => {
    const agent = await createUser(h, owner, 'AGENT')
    expect((await api('POST', '/api/templates/sync', undefined, agent)).statusCode).toBe(403)
    expect((await api('GET', '/api/templates', undefined, agent)).statusCode).toBe(200)
  })
})

describe('sending templates (FR-41)', () => {
  async function approvedTemplate() {
    await api('POST', '/api/templates', orderTemplate)
    mock.templates[0]!.status = 'APPROVED'
    await api('POST', '/api/templates/sync')
    return (await h.ctx.db.template.findFirstOrThrow()).id
  }

  it('starts a conversation with a new contact and fills variables from contact fields', async () => {
    const templateId = await approvedTemplate()
    const contact = (
      await api('POST', '/api/contacts', { waId: '966500000050', name: 'سارة القحطاني' })
    ).json().contact
    await h.ctx.db.contact.update({ where: { id: contact.id }, data: { city: 'العليا' } })

    const res = await api('POST', `/api/contacts/${contact.id}/template`, {
      templateId,
      variables: [{ field: 'contact.firstName' }, { value: '1042' }, { field: 'contact.city' }],
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().message).toMatchObject({ type: 'TEMPLATE', status: 'QUEUED' })
    expect(res.json().message.body).toContain(
      'مرحبا سارة، طلبك رقم 1042 جاهز للاستلام من فرع العليا.',
    )

    // Outside the 24-hour window (the customer never wrote), templates still go out.
    await h.ctx.outbound.send(res.json().message.id, { finalAttempt: false })
    expect(mock.sent[0]).toMatchObject({
      to: '966500000050',
      type: 'template',
      body: {
        template: {
          name: 'order_ready',
          language: { code: 'ar' },
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: 'سارة' },
                { type: 'text', text: '1042' },
                { type: 'text', text: 'العليا' },
              ],
            },
          ],
        },
      },
    })
  })

  it('refuses unapproved templates and missing variables', async () => {
    await api('POST', '/api/templates', orderTemplate)
    const pendingId = (await h.ctx.db.template.findFirstOrThrow()).id
    const contact = (await api('POST', '/api/contacts', { waId: '966500000051' })).json().contact

    const pending = await api('POST', `/api/contacts/${contact.id}/template`, {
      templateId: pendingId,
      variables: [],
    })
    expect(pending.json().error).toBe('not_approved')

    mock.templates[0]!.status = 'APPROVED'
    await api('POST', '/api/templates/sync')
    const missing = await api('POST', `/api/contacts/${contact.id}/template`, {
      templateId: pendingId,
      // The contact has no city, so variable 3 would be empty.
      variables: [{ value: 'Ali' }, { value: '1' }, { field: 'contact.city' }],
    })
    expect(missing.statusCode).toBe(400)
    expect(missing.json().error).toBe('missing_variables')
  })
})
