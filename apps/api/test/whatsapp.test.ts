import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MockGraph } from '../src/dev/mock-graph.js'
import { runSweep } from '../src/jobs/sweep.js'
import { jobId } from '../src/lib/queues.js'
import { SendFailure } from '../src/services/outbound.js'
import { inboundPayload, statusPayload, textMessage } from '../src/whatsapp/fixtures.js'
import { signWebhookBody } from '../src/whatsapp/signature.js'
import { createHarness, createUser, type Harness, setupOwner } from './harness.js'

const APP_SECRET = 'feedface'.repeat(4)
const CUSTOMER = '966500000001'

let h: Harness
let mock: MockGraph
let mediaDir: string
let owner: string

beforeAll(async () => {
  mock = new MockGraph()
  await mock.start()
  mediaDir = await mkdtemp(path.join(tmpdir(), 'raseel-media-'))
  h = await createHarness({ WHATSAPP_GRAPH_URL: mock.url, MEDIA_DIR: mediaDir })
})
afterAll(async () => {
  await h.close()
  await mock.close()
  await rm(mediaDir, { recursive: true, force: true })
})
beforeEach(async () => {
  await h.reset()
  mock.sent.length = 0
  owner = await setupOwner(h)
})

const connect = () =>
  h.app.inject({
    method: 'PUT',
    url: '/api/whatsapp/settings',
    headers: { cookie: owner },
    payload: {
      phoneNumberId: mock.phoneNumberId,
      wabaId: mock.wabaId,
      accessToken: mock.accessToken,
      appSecret: APP_SECRET,
    },
  })

const postWebhook = (payload: unknown, secret = APP_SECRET) => {
  const raw = JSON.stringify(payload)
  return h.app.inject({
    method: 'POST',
    url: '/webhooks/whatsapp',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': signWebhookBody(raw, secret),
    },
    payload: raw,
  })
}

/** Delivers a webhook through the HTTP endpoint and processes it like the worker would. */
async function deliver(payload: unknown) {
  const res = await postWebhook(payload)
  expect(res.statusCode).toBe(200)
  const event = await h.ctx.db.webhookEvent.findFirstOrThrow({ orderBy: { receivedAt: 'desc' } })
  await h.ctx.inbound.processWebhookEvent(event.id)
}

const customerSays = (text: string, opts: { at?: Date; id?: string } = {}) =>
  deliver(
    inboundPayload(
      { phoneNumberId: mock.phoneNumberId, from: CUSTOMER, name: 'سارة' },
      textMessage(text),
      opts,
    ),
  )

describe('WhatsApp connection (FR-02, FR-03)', () => {
  it('verifies credentials with Meta and never returns the token', async () => {
    const res = await connect()
    expect(res.statusCode).toBe(200)
    expect(res.json().phone.verifiedName).toBe('Raseel Demo')

    const settings = await h.app.inject({
      method: 'GET',
      url: '/api/whatsapp/settings',
      headers: { cookie: owner },
    })
    const body = settings.json()
    expect(body).toMatchObject({ connected: true, appSecretSet: true })
    expect(body.accessToken).toMatch(/^••••/)
    expect(JSON.stringify(body)).not.toContain(mock.accessToken)
    expect(body.webhook.url).toBe('http://localhost:3000/webhooks/whatsapp')

    const row = await h.ctx.db.setting.findUniqueOrThrow({
      where: { key: 'whatsapp.access_token' },
    })
    expect(row.encrypted).toBe(true)
    expect(row.value).not.toContain(mock.accessToken)
  })

  it('rejects credentials Meta does not accept', async () => {
    const res = await h.app.inject({
      method: 'PUT',
      url: '/api/whatsapp/settings',
      headers: { cookie: owner },
      payload: {
        phoneNumberId: mock.phoneNumberId,
        wabaId: mock.wabaId,
        accessToken: 'wrong-token-wrong-token-wrong',
        appSecret: APP_SECRET,
      },
    })
    expect(res.statusCode).toBe(422)
    expect(res.json()).toMatchObject({
      error: 'whatsapp_verification_failed',
      detail: { code: 190 },
    })
  })

  it('is owner-only', async () => {
    const admin = await createUser(h, owner, 'ADMIN')
    const res = await h.app.inject({
      method: 'GET',
      url: '/api/whatsapp/settings',
      headers: { cookie: admin },
    })
    expect(res.statusCode).toBe(403)
  })

  it('answers Meta’s webhook verification challenge', async () => {
    await connect()
    const { webhook } = (
      await h.app.inject({
        method: 'GET',
        url: '/api/whatsapp/settings',
        headers: { cookie: owner },
      })
    ).json()
    const ok = await h.app.inject({
      method: 'GET',
      url: `/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=${webhook.verifyToken}&hub.challenge=1158201444`,
    })
    expect(ok.statusCode).toBe(200)
    expect(ok.body).toBe('1158201444')

    const bad = await h.app.inject({
      method: 'GET',
      url: '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1',
    })
    expect(bad.statusCode).toBe(403)
  })
})

describe('webhook receiver (NFR-04, NFR-07)', () => {
  beforeEach(async () => {
    await connect()
  })

  it('rejects unsigned or wrongly signed requests', async () => {
    const payload = inboundPayload(
      { phoneNumberId: mock.phoneNumberId, from: CUSTOMER },
      textMessage('hi'),
    )
    const res = await postWebhook(payload, 'deadbeef'.repeat(4))
    expect(res.statusCode).toBe(401)
    expect(await h.ctx.db.webhookEvent.count()).toBe(0)
  })

  it('stores the raw event, queues it and records the first webhook', async () => {
    const res = await postWebhook(
      inboundPayload({ phoneNumberId: mock.phoneNumberId, from: CUSTOMER }, textMessage('hi')),
    )
    expect(res.statusCode).toBe(200)
    const event = await h.ctx.db.webhookEvent.findFirstOrThrow()
    expect(event.status).toBe('PENDING')
    expect(await h.ctx.queues.webhook.getJob(jobId('webhook', event.id))).toBeTruthy()
    expect(await h.ctx.settings.get('whatsapp.first_webhook_at')).toBeTruthy()
  })

  it('re-queues events that never reached the queue', async () => {
    const event = await h.ctx.db.webhookEvent.create({
      data: { payload: {}, receivedAt: new Date(Date.now() - 5 * 60_000) },
    })
    const result = await runSweep(h.ctx)
    expect(result.webhookEvents).toBe(1)
    expect(await h.ctx.queues.webhook.getJob(jobId('webhook', event.id))).toBeTruthy()
  })
})

describe('inbound messages (FR-10, FR-16, FR-30)', () => {
  beforeEach(async () => {
    await connect()
  })

  it('creates the contact and conversation from the first message', async () => {
    await customerSays('السلام عليكم')
    const contact = await h.ctx.db.contact.findUniqueOrThrow({ where: { waId: CUSTOMER } })
    expect(contact.waName).toBe('سارة')
    const conversation = await h.ctx.db.conversation.findFirstOrThrow({
      where: { contactId: contact.id },
    })
    expect(conversation).toMatchObject({
      status: 'OPEN',
      unreadCount: 1,
      lastMessagePreview: 'السلام عليكم',
    })
    expect(conversation.lastInboundAt).toBeTruthy()
  })

  it('ignores duplicate deliveries of the same message', async () => {
    await customerSays('مرحبا', { id: 'wamid.SAME' })
    await customerSays('مرحبا', { id: 'wamid.SAME' })
    expect(await h.ctx.db.message.count()).toBe(1)
    expect((await h.ctx.db.conversation.findFirstOrThrow()).unreadCount).toBe(1)
  })

  it('reopens a closed conversation when the customer writes again', async () => {
    await customerSays('first')
    const conv = await h.ctx.db.conversation.findFirstOrThrow()
    await h.ctx.db.conversation.update({
      where: { id: conv.id },
      data: { status: 'CLOSED', closedAt: new Date() },
    })
    await customerSays('second')
    const after = await h.ctx.db.conversation.findFirstOrThrow()
    expect(after.id).toBe(conv.id)
    expect(after.status).toBe('OPEN')
    expect(after.closedAt).toBeNull()
    expect(await h.ctx.db.conversation.count()).toBe(1)
  })

  it('downloads inbound media and serves it to staff only', async () => {
    const mediaId = mock.addMedia(Buffer.from('fake-jpeg-bytes'), 'image/jpeg')
    await deliver(
      inboundPayload(
        { phoneNumberId: mock.phoneNumberId, from: CUSTOMER },
        { type: 'image', image: { id: mediaId, mime_type: 'image/jpeg', caption: 'الفاتورة' } },
      ),
    )
    const message = await h.ctx.db.message.findFirstOrThrow()
    expect(message).toMatchObject({ type: 'IMAGE', body: 'الفاتورة', mediaPath: null })
    expect(await h.ctx.queues.media.getJob(jobId('media', message.id))).toBeTruthy()

    expect(await h.ctx.inbound.downloadMedia(message.id)).toBe(true)
    const res = await h.app.inject({
      method: 'GET',
      url: `/api/media/${message.id}`,
      headers: { cookie: owner },
    })
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('image/jpeg')
    expect(res.body).toBe('fake-jpeg-bytes')

    const anonymous = await h.app.inject({ method: 'GET', url: `/api/media/${message.id}` })
    expect(anonymous.statusCode).toBe(401)
  })
})

describe('sending replies (FR-11, FR-12, FR-13, NFR-05)', () => {
  let conversationId: string

  beforeEach(async () => {
    await connect()
    await customerSays('أبغى أحجز موعد')
    conversationId = (await h.ctx.db.conversation.findFirstOrThrow()).id
  })

  const reply = (body: string, cookie = owner) =>
    h.app.inject({
      method: 'POST',
      url: `/api/conversations/${conversationId}/messages`,
      headers: { cookie },
      payload: { type: 'text', body },
    })

  it('queues, sends and tracks a reply through read', async () => {
    const res = await reply('أهلاً، متى يناسبك؟')
    expect(res.statusCode).toBe(201)
    const { message } = res.json()
    expect(message.status).toBe('QUEUED')
    expect(await h.ctx.queues.send.getJob(jobId('send', message.id))).toBeTruthy()

    await h.ctx.outbound.send(message.id, { finalAttempt: false })
    expect(mock.sent[0]).toMatchObject({ to: CUSTOMER, type: 'text' })
    const sent = await h.ctx.db.message.findUniqueOrThrow({ where: { id: message.id } })
    expect(sent).toMatchObject({ status: 'SENT', waMessageId: mock.sent[0]!.waMessageId })

    const status = (s: 'delivered' | 'read') =>
      deliver(statusPayload(mock.phoneNumberId, sent.waMessageId!, CUSTOMER, s))
    await status('read')
    await status('delivered') // arrives late; must not downgrade
    expect((await h.ctx.db.message.findUniqueOrThrow({ where: { id: message.id } })).status).toBe(
      'READ',
    )
  })

  it('keeps the message queued on throttling and sends on retry', async () => {
    const { message } = (await reply('retry me')).json()
    mock.failNext({ code: 130429, message: 'Rate limit hit' })

    const err = await h.ctx.outbound
      .send(message.id, { finalAttempt: false })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(SendFailure)
    expect((err as SendFailure).permanent).toBe(false)
    expect((await h.ctx.db.message.findUniqueOrThrow({ where: { id: message.id } })).status).toBe(
      'QUEUED',
    )

    expect(await h.ctx.outbound.send(message.id, { finalAttempt: false })).toBe('sent')
  })

  it('fails permanently with Meta’s reason when the error cannot be retried', async () => {
    const { message } = (await reply('too late')).json()
    mock.failNext({
      code: 131047,
      message: 'More than 24 hours have passed since the customer last replied',
    })
    const err = (await h.ctx.outbound
      .send(message.id, { finalAttempt: false })
      .catch((e: unknown) => e)) as SendFailure
    expect(err.permanent).toBe(true)
    const failed = await h.ctx.db.message.findUniqueOrThrow({ where: { id: message.id } })
    expect(failed.status).toBe('FAILED')
    expect(failed.error).toMatchObject({ code: 131047 })

    const retry = await h.app.inject({
      method: 'POST',
      url: `/api/conversations/${conversationId}/messages/${message.id}/retry`,
      headers: { cookie: owner },
    })
    expect(retry.statusCode).toBe(200)
    expect((await h.ctx.db.message.findUniqueOrThrow({ where: { id: message.id } })).status).toBe(
      'QUEUED',
    )
  })

  it('refuses free-form replies outside the 24-hour window', async () => {
    await h.ctx.db.conversation.update({
      where: { id: conversationId },
      data: { lastInboundAt: new Date(Date.now() - 25 * 3600 * 1000) },
    })
    const res = await reply('hello?')
    expect(res.statusCode).toBe(422)
    expect(res.json().error).toBe('window_closed')
  })

  it('does not let viewers reply', async () => {
    const viewer = await createUser(h, owner, 'VIEWER')
    expect((await reply('hi', viewer)).statusCode).toBe(403)
  })

  it('uploads and sends an image with a caption', async () => {
    const boundary = '----raseel'
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="caption"',
      '',
      'هذه صورة العيادة',
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="clinic.png"',
      'Content-Type: image/png',
      '',
      'png-bytes',
      `--${boundary}--`,
      '',
    ].join('\r\n')
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/conversations/${conversationId}/messages`,
      headers: { cookie: owner, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    })
    expect(res.statusCode).toBe(201)
    const { message } = res.json()
    expect(message).toMatchObject({ type: 'IMAGE', body: 'هذه صورة العيادة' })

    await h.ctx.outbound.send(message.id, { finalAttempt: false })
    const sent = mock.sent.at(-1)!
    expect(sent.type).toBe('image')
    const image = sent.body.image as { id: string; caption: string }
    expect(image.caption).toBe('هذه صورة العيادة')
    expect(mock.media.get(image.id)?.data.toString()).toBe('png-bytes')
  })

  it('sends the customer a read receipt when an agent opens the conversation', async () => {
    const last = await h.ctx.db.message.findFirstOrThrow({ where: { direction: 'INBOUND' } })
    await h.app.inject({
      method: 'POST',
      url: `/api/conversations/${conversationId}/read`,
      headers: { cookie: owner },
    })
    const job = await h.ctx.queues.send.getJob(jobId('read', last.id))
    expect(job?.name).toBe('read')

    expect(await h.ctx.outbound.markRead(last.id)).toBe(true)
    expect(mock.reads).toContain(last.waMessageId)
  })

  it('lists conversations and messages with reply context', async () => {
    await customerSays('second message')
    const list = await h.app.inject({
      method: 'GET',
      url: '/api/conversations',
      headers: { cookie: owner },
    })
    expect(list.json().conversations[0]).toMatchObject({
      id: conversationId,
      unreadCount: 2,
      windowOpen: true,
      contact: { waId: CUSTOMER, name: 'سارة' },
    })

    const msgs = await h.app.inject({
      method: 'GET',
      url: `/api/conversations/${conversationId}/messages`,
      headers: { cookie: owner },
    })
    expect(msgs.json().messages.map((m: { body: string }) => m.body)).toEqual([
      'أبغى أحجز موعد',
      'second message',
    ])

    await h.app.inject({
      method: 'POST',
      url: `/api/conversations/${conversationId}/read`,
      headers: { cookie: owner },
    })
    expect(
      (await h.ctx.db.conversation.findUniqueOrThrow({ where: { id: conversationId } }))
        .unreadCount,
    ).toBe(0)
  })
})
