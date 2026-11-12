import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { fakeWamid } from '../src/whatsapp/fixtures.js'
import { createHarness, createUser, type Harness, setupOwner } from './harness.js'

let h: Harness
let owner: string
let conversationId: string

beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => {
  await h.close()
})
beforeEach(async () => {
  await h.reset()
  owner = await setupOwner(h)
  await h.ctx.inbound.handleMessage({
    waMessageId: fakeWamid(),
    from: '966500000099',
    profileName: 'Noura',
    timestamp: new Date(),
    type: 'TEXT',
    body: 'Where is my order?',
    payload: null,
    media: null,
    replyToWaId: null,
  })
  conversationId = (await h.ctx.db.conversation.findFirstOrThrow()).id
})

const userId = (email: string) =>
  h.ctx.db.user.findUniqueOrThrow({ where: { email } }).then((u) => u.id)

describe('internal notes (FR-17)', () => {
  it('stores notes with mentions and notifies only the mentioned colleague', async () => {
    const agent = await createUser(h, owner, 'AGENT')
    const agentId = await userId('agent@example.com')
    const ownerId = await userId('owner@example.com')

    const res = await h.app.inject({
      method: 'POST',
      url: `/api/conversations/${conversationId}/notes`,
      headers: { cookie: owner },
      payload: {
        body: `<@${agentId}> please check the courier. Also <@${ownerId}> <@nonexistentuser01>`,
      },
    })
    expect(res.statusCode).toBe(201)
    // The author and unknown ids are not notified.
    expect(res.json().note.mentionedUserIds).toEqual([agentId])

    const mentions = await h.app.inject({
      method: 'GET',
      url: '/api/mentions',
      headers: { cookie: agent },
    })
    expect(mentions.json()).toMatchObject({
      unread: 1,
      mentions: [{ conversationId, contactName: 'Noura', author: { name: 'Huda' } }],
    })

    await h.app.inject({
      method: 'POST',
      url: '/api/mentions/read',
      headers: { cookie: agent },
      payload: { conversationId },
    })
    const after = await h.app.inject({
      method: 'GET',
      url: '/api/mentions',
      headers: { cookie: agent },
    })
    expect(after.json().unread).toBe(0)
  })

  it('never sends notes to the customer', async () => {
    await h.app.inject({
      method: 'POST',
      url: `/api/conversations/${conversationId}/notes`,
      headers: { cookie: owner },
      payload: { body: 'internal only' },
    })
    expect(await h.ctx.db.message.count({ where: { direction: 'OUTBOUND' } })).toBe(0)
    expect(await h.ctx.queues.send.count()).toBe(0)
  })

  it('lets viewers read notes but not write them', async () => {
    const viewer = await createUser(h, owner, 'VIEWER')
    const write = await h.app.inject({
      method: 'POST',
      url: `/api/conversations/${conversationId}/notes`,
      headers: { cookie: viewer },
      payload: { body: 'hi' },
    })
    expect(write.statusCode).toBe(403)
    const read = await h.app.inject({
      method: 'GET',
      url: `/api/conversations/${conversationId}/notes`,
      headers: { cookie: viewer },
    })
    expect(read.statusCode).toBe(200)
  })
})

describe('quick replies (FR-18)', () => {
  it('lets admins manage replies in Arabic and English and agents use them', async () => {
    const agent = await createUser(h, owner, 'AGENT')
    const create = await h.app.inject({
      method: 'POST',
      url: '/api/quick-replies',
      headers: { cookie: owner },
      payload: {
        shortcut: 'مواعيد',
        title: 'ساعات العمل',
        body: 'نعمل من 9 صباحاً إلى 9 مساءً',
        language: 'ar',
      },
    })
    expect(create.statusCode).toBe(201)

    const dup = await h.app.inject({
      method: 'POST',
      url: '/api/quick-replies',
      headers: { cookie: owner },
      payload: { shortcut: 'مواعيد', title: 'x', body: 'y' },
    })
    expect(dup.statusCode).toBe(409)

    const agentCreate = await h.app.inject({
      method: 'POST',
      url: '/api/quick-replies',
      headers: { cookie: agent },
      payload: { shortcut: 'hi', title: 'Hi', body: 'Hello!' },
    })
    expect(agentCreate.statusCode).toBe(403)

    const list = await h.app.inject({
      method: 'GET',
      url: '/api/quick-replies',
      headers: { cookie: agent },
    })
    expect(list.json().quickReplies).toEqual([
      expect.objectContaining({ shortcut: 'مواعيد', language: 'ar' }),
    ])
  })
})
