import { can } from '@raseel/shared'
import type { FastifyInstance } from 'fastify'
import { Server, type Socket } from 'socket.io'
import type { User } from './lib/db.js'
import { loadConversationDto, loadMessageDto } from './routes/conversations.js'
import { noteDto } from './routes/notes.js'
import { SESSION_COOKIE } from './services/auth.js'
import { EVENTS_CHANNEL, type RealtimeEvent } from './services/events.js'

interface SocketData {
  user: Pick<User, 'id' | 'name' | 'role'>
  token: string
  conversationId: string | null
  typing: boolean
}

type StaffSocket = Socket<
  Record<string, (...args: never[]) => void>,
  Record<string, (...args: never[]) => void>,
  Record<string, never>,
  SocketData
>

const STAFF_ROOM = 'staff'
const userRoom = (id: string) => `user:${id}`
const conversationRoom = (id: string) => `conversation:${id}`

/**
 * NFR-01: pushes new messages, status updates, notes and mentions to agents the moment
 * they happen. FR-19: tells agents who else is viewing or typing in a conversation.
 *
 * Events come from Redis, so changes made by the worker reach browsers too.
 * Presence is kept in memory; Raseel runs a single API process per install.
 */
export function attachRealtime(app: FastifyInstance): Server {
  const { db, redis, auth, config } = app.ctx
  const io = new Server(app.server, {
    path: '/socket.io',
    serveClient: false,
    cors: { origin: config.APP_URL, credentials: true },
  })

  // Authenticate with the same signed, HTTP-only session cookie as the API.
  io.use(async (socket, next) => {
    try {
      const cookies = app.parseCookie(socket.handshake.headers.cookie ?? '')
      const raw = cookies[SESSION_COOKIE]
      const unsigned = raw ? app.unsignCookie(raw) : null
      if (!unsigned?.valid || !unsigned.value) return next(new Error('unauthorized'))
      const session = await auth.resolveSession(unsigned.value)
      if (!session || !can(session.user.role, 'conversations:view')) {
        return next(new Error('unauthorized'))
      }
      const data = socket.data as SocketData
      data.user = { id: session.user.id, name: session.user.name, role: session.user.role }
      data.token = unsigned.value
      data.conversationId = null
      data.typing = false
      next()
    } catch (err) {
      next(err as Error)
    }
  })

  async function broadcastPresence(conversationId: string) {
    const sockets = (await io.in(conversationRoom(conversationId)).fetchSockets()) as unknown as {
      data: SocketData
    }[]
    const viewers = new Map<string, { userId: string; name: string; typing: boolean }>()
    for (const s of sockets) {
      const prev = viewers.get(s.data.user.id)
      viewers.set(s.data.user.id, {
        userId: s.data.user.id,
        name: s.data.user.name,
        typing: (prev?.typing ?? false) || s.data.typing,
      })
    }
    io.to(conversationRoom(conversationId)).emit('presence', {
      conversationId,
      viewers: [...viewers.values()],
    })
  }

  async function leaveConversation(socket: StaffSocket) {
    const current = socket.data.conversationId
    if (!current) return
    socket.data.conversationId = null
    socket.data.typing = false
    await socket.leave(conversationRoom(current))
    await broadcastPresence(current)
  }

  io.on('connection', (socket: StaffSocket) => {
    void socket.join([STAFF_ROOM, userRoom(socket.data.user.id)])

    socket.on('conversation:join', async (conversationId: unknown) => {
      if (typeof conversationId !== 'string' || conversationId.length > 64) return
      if (socket.data.conversationId === conversationId) return
      await leaveConversation(socket)
      socket.data.conversationId = conversationId
      await socket.join(conversationRoom(conversationId))
      await broadcastPresence(conversationId)
    })

    socket.on('conversation:leave', () => void leaveConversation(socket))

    socket.on('typing', async (typing: unknown) => {
      const current = socket.data.conversationId
      if (!current || typeof typing !== 'boolean' || socket.data.typing === typing) return
      socket.data.typing = typing
      await broadcastPresence(current)
    })

    socket.on('disconnect', () => {
      const current = socket.data.conversationId
      if (current) void broadcastPresence(current)
    })
  })

  // Relay domain events to browsers with the data they need to render.
  const subscriber = redis.duplicate()
  void subscriber.subscribe(EVENTS_CHANNEL)
  subscriber.on('message', async (_channel, raw) => {
    let event: RealtimeEvent
    try {
      event = JSON.parse(raw) as RealtimeEvent
    } catch {
      return
    }
    try {
      switch (event.type) {
        case 'message.created':
        case 'message.updated': {
          const message = await loadMessageDto(db, event.messageId)
          if (message) {
            io.to(STAFF_ROOM).emit('message', { conversationId: event.conversationId, message })
          }
          break
        }
        case 'conversation.updated': {
          const conversation = await loadConversationDto(db, event.conversationId)
          if (conversation) io.to(STAFF_ROOM).emit('conversation', { conversation })
          break
        }
        case 'note.created': {
          const note = await db.note.findUnique({
            where: { id: event.noteId },
            include: {
              author: { select: { id: true, name: true } },
              mentions: { select: { userId: true } },
            },
          })
          if (note) io.to(STAFF_ROOM).emit('note', { note: noteDto(note) })
          break
        }
        case 'mention.created':
          io.to(userRoom(event.userId)).emit('mention', {
            conversationId: event.conversationId,
            noteId: event.noteId,
          })
          break
      }
    } catch (err) {
      app.log.error({ err, event: event.type }, 'failed to relay realtime event')
    }
  })

  // Disconnect sockets whose session was revoked (logout, deactivation, password change).
  const sessionCheck = setInterval(async () => {
    for (const s of (await io.fetchSockets()) as unknown as {
      data: SocketData
      disconnect: (close?: boolean) => void
    }[]) {
      const session = await auth.resolveSession(s.data.token).catch(() => null)
      if (!session) s.disconnect(true)
    }
  }, 60_000)
  sessionCheck.unref()

  app.addHook('onClose', async () => {
    clearInterval(sessionCheck)
    await new Promise<void>((resolve) => io.close(() => resolve()))
    await subscriber.quit().catch(() => undefined)
  })

  return io
}
