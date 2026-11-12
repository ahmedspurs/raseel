import { io, type Socket } from 'socket.io-client'

let socket: Socket | null = null
const connected = ref(false)

/**
 * One Socket.io connection per tab, authenticated by the session cookie.
 * Connects after sign-in and disconnects on sign-out.
 */
export function useRealtime() {
  function connect(): Socket {
    if (socket) return socket
    socket = io({ path: '/socket.io', withCredentials: true, transports: ['websocket', 'polling'] })
    socket.on('connect', () => (connected.value = true))
    socket.on('disconnect', () => (connected.value = false))
    return socket
  }

  function disconnect() {
    socket?.disconnect()
    socket = null
    connected.value = false
  }

  /** Subscribes for the lifetime of the calling component. */
  function on<T>(event: string, handler: (data: T) => void) {
    const s = connect()
    s.on(event, handler)
    onBeforeUnmount(() => s.off(event, handler))
  }

  return { connect, disconnect, on, connected, socket: () => socket }
}
