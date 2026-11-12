import type { AddressInfo } from 'node:net'
import { io as connect, type Socket } from 'socket.io-client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { fakeWamid } from '../src/whatsapp/fixtures.js'
import { createHarness, createUser, type Harness, setupOwner } from './harness.js'

let h: Harness
let url: string
let owner: string
const sockets: Socket[] = []

beforeAll(async () => {
  h = await createHarness()
  await h.app.listen({ port: 0, host: '127.0.0.1' })
  url = `http://127.0.0.1:${(h.app.server.address() as AddressInfo).port}`
})
afterAll(async () => {
  await h.close()
})
beforeEach(async () => {
  await h.reset()
  owner = await setupOwner(h)
})
afterEach(() => {
  for (const s of sockets.splice(0)) s.disconnect()
})

function open(cookie?: string): Promise<Socket> {
  const socket = connect(url, {
    path: '/socket.io',
    transports: ['websocket'],
    extraHeaders: cookie ? { cookie } : {},
    reconnection: false,
  })
  sockets.push(socket)
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket))
    socket.once('connect_error', reject)
  })
}

function next<T>(socket: Socket, event: string, match: (data: T) => boolean = () => true) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${event}`)), 5000)
    const handler = (data: T) => {
      if (!match(data)) return
      clearTimeout(timer)
      socket.off(event, handler)
      resolve(data)
    }
    socket.on(event, handler)
  })
}

const inbound = (body: string) =>
  h.ctx.inbound.handleMessage({
    waMessageId: fakeWamid(),
    from: '966500000077',
    profileName: 'Faisal',
    timestamp: new Date(),
    type: 'TEXT',
    body,
    payload: null,
    media: null,
    replyToWaId: null,
  })

describe('realtime (NFR-01)', () => {
  it('rejects connections without a valid session', async () => {
    await expect(open()).rejects.toThrow('unauthorized')
    await expect(open('raseel_session=forged')).rejects.toThrow('unauthorized')
  })

  it('pushes new customer messages and conversation updates within seconds', async () => {
    const socket = await open(owner)
    const message = next<{ message: { body: string; direction: string } }>(socket, 'message')
    const conversation = next<{ conversation: { unreadCount: number } }>(socket, 'conversation')

    const started = Date.now()
    await inbound('هل الطلب جاهز؟')

    expect((await message).message).toMatchObject({ body: 'هل الطلب جاهز؟', direction: 'INBOUND' })
    expect((await conversation).conversation.unreadCount).toBe(1)
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('delivers mentions only to the mentioned user', async () => {
    const agentCookie = await createUser(h, owner, 'AGENT')
    const agentId = (
      await h.ctx.db.user.findUniqueOrThrow({ where: { email: 'agent@example.com' } })
    ).id
    await inbound('hello')
    const conversationId = (await h.ctx.db.conversation.findFirstOrThrow()).id

    const agent = await open(agentCookie)
    const ownerSocket = await open(owner)
    let ownerGotMention = false
    ownerSocket.on('mention', () => (ownerGotMention = true))

    const mention = next<{ conversationId: string }>(agent, 'mention')
    const note = next<{ note: { body: string } }>(ownerSocket, 'note')
    await h.app.inject({
      method: 'POST',
      url: `/api/conversations/${conversationId}/notes`,
      headers: { cookie: owner },
      payload: { body: `<@${agentId}> can you take this?` },
    })
    expect((await mention).conversationId).toBe(conversationId)
    expect((await note).note.body).toContain('can you take this')
    await new Promise((r) => setTimeout(r, 200))
    expect(ownerGotMention).toBe(false)
  })
})

describe('collision warning (FR-19)', () => {
  it('shows who else is viewing and typing in a conversation', async () => {
    const agentCookie = await createUser(h, owner, 'AGENT')
    await inbound('hi')
    const conversationId = (await h.ctx.db.conversation.findFirstOrThrow()).id

    const a = await open(owner)
    const b = await open(agentCookie)

    a.emit('conversation:join', conversationId)
    await next(a, 'presence', (p: { viewers: unknown[] }) => p.viewers.length === 1)

    const both = next<{ viewers: { name: string }[] }>(a, 'presence', (p) => p.viewers.length === 2)
    b.emit('conversation:join', conversationId)
    expect((await both).viewers.map((v) => v.name).sort()).toEqual(['AGENT', 'Huda'])

    const typing = next<{ viewers: { name: string; typing: boolean }[] }>(a, 'presence', (p) =>
      p.viewers.some((v) => v.typing),
    )
    b.emit('typing', true)
    expect((await typing).viewers.find((v) => v.typing)?.name).toBe('AGENT')

    const left = next<{ viewers: unknown[] }>(a, 'presence', (p) => p.viewers.length === 1)
    b.disconnect()
    await left
  })
})
