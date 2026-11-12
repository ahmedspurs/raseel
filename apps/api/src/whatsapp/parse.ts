import type { MessageType } from '../generated/prisma/enums.js'

/** A customer message, normalized from any WhatsApp webhook message type (FR-10). */
export interface InboundMessage {
  waMessageId: string
  from: string
  profileName: string | null
  timestamp: Date
  type: MessageType
  /** Text to show and search: message text, caption, button title, location name… */
  body: string | null
  payload: Record<string, unknown> | null
  media: {
    id: string
    mimeType: string | null
    filename: string | null
    voice: boolean
  } | null
  /** wamid this message replies or reacts to. */
  replyToWaId: string | null
}

export type DeliveryStatus = 'sent' | 'delivered' | 'read' | 'failed'

export interface StatusUpdate {
  waMessageId: string
  status: DeliveryStatus
  timestamp: Date
  recipientId: string
  error: { code: number | null; title: string | null; message: string | null } | null
}

export interface ParsedWebhook {
  messages: InboundMessage[]
  statuses: StatusUpdate[]
}

// ── Minimal shapes of Meta's payload (only the fields we read) ──

interface WaMedia {
  id: string
  mime_type?: string
  caption?: string
  filename?: string
  voice?: boolean
}

interface WaMessage {
  id: string
  from: string
  timestamp: string
  type: string
  context?: { id?: string }
  text?: { body: string }
  image?: WaMedia
  video?: WaMedia
  audio?: WaMedia
  document?: WaMedia
  sticker?: WaMedia & { animated?: boolean }
  location?: { latitude: number; longitude: number; name?: string; address?: string; url?: string }
  contacts?: {
    name?: { formatted_name?: string }
    phones?: { phone?: string; wa_id?: string; type?: string }[]
  }[]
  reaction?: { message_id: string; emoji?: string }
  interactive?: {
    type: 'button_reply' | 'list_reply' | string
    button_reply?: { id: string; title: string }
    list_reply?: { id: string; title: string; description?: string }
  }
  button?: { text: string; payload?: string }
  errors?: { code?: number; title?: string; message?: string }[]
}

interface WaStatus {
  id: string
  status: string
  timestamp: string
  recipient_id: string
  errors?: { code?: number; title?: string; message?: string; error_data?: { details?: string } }[]
}

interface WaValue {
  metadata?: { phone_number_id?: string }
  contacts?: { wa_id: string; profile?: { name?: string } }[]
  messages?: WaMessage[]
  statuses?: WaStatus[]
}

interface WaPayload {
  object?: string
  entry?: { changes?: { field?: string; value?: WaValue }[] }[]
}

const MEDIA_TYPES = {
  image: 'IMAGE',
  video: 'VIDEO',
  audio: 'AUDIO',
  document: 'DOCUMENT',
  sticker: 'STICKER',
} as const satisfies Record<string, MessageType>

/** Webhook message types that are signals, not conversation messages. */
const IGNORED_TYPES = new Set(['request_welcome'])

const toDate = (unixSeconds: string) => new Date(Number(unixSeconds) * 1000)

function parseMessage(m: WaMessage, profileName: string | null): InboundMessage | null {
  if (IGNORED_TYPES.has(m.type)) return null

  const base: InboundMessage = {
    waMessageId: m.id,
    from: m.from,
    profileName,
    timestamp: toDate(m.timestamp),
    type: 'UNSUPPORTED',
    body: null,
    payload: null,
    media: null,
    replyToWaId: m.context?.id ?? null,
  }

  if (m.type === 'text' && m.text) {
    return { ...base, type: 'TEXT', body: m.text.body }
  }

  if (m.type in MEDIA_TYPES) {
    const media = m[m.type as keyof typeof MEDIA_TYPES]
    if (media) {
      return {
        ...base,
        type: MEDIA_TYPES[m.type as keyof typeof MEDIA_TYPES],
        body: media.caption ?? null,
        media: {
          id: media.id,
          mimeType: media.mime_type ?? null,
          filename: media.filename ?? null,
          voice: media.voice === true,
        },
        payload: m.type === 'sticker' ? { animated: m.sticker?.animated === true } : null,
      }
    }
  }

  if (m.type === 'location' && m.location) {
    const { latitude, longitude, name, address, url } = m.location
    return {
      ...base,
      type: 'LOCATION',
      body: [name, address].filter(Boolean).join(' — ') || null,
      payload: {
        latitude,
        longitude,
        name: name ?? null,
        address: address ?? null,
        url: url ?? null,
      },
    }
  }

  if (m.type === 'contacts' && m.contacts) {
    const contacts = m.contacts.map((c) => ({
      name: c.name?.formatted_name ?? null,
      phones: (c.phones ?? []).map((p) => ({ phone: p.phone ?? null, waId: p.wa_id ?? null })),
    }))
    return {
      ...base,
      type: 'CONTACTS',
      body:
        contacts
          .map((c) => c.name)
          .filter(Boolean)
          .join('، ') || null,
      payload: { contacts },
    }
  }

  if (m.type === 'reaction' && m.reaction) {
    return {
      ...base,
      type: 'REACTION',
      // An empty emoji means the customer removed their reaction.
      body: m.reaction.emoji || null,
      payload: { emoji: m.reaction.emoji ?? '', removed: !m.reaction.emoji },
      replyToWaId: m.reaction.message_id,
    }
  }

  if (m.type === 'interactive' && m.interactive) {
    const reply = m.interactive.button_reply ?? m.interactive.list_reply
    return {
      ...base,
      type: 'INTERACTIVE',
      body: reply?.title ?? null,
      payload: { kind: m.interactive.type, id: reply?.id ?? null, title: reply?.title ?? null },
    }
  }

  if (m.type === 'button' && m.button) {
    return {
      ...base,
      type: 'BUTTON',
      body: m.button.text,
      payload: { payload: m.button.payload ?? null },
    }
  }

  // unsupported, order, system, or a type added by Meta later.
  return {
    ...base,
    type: 'UNSUPPORTED',
    payload: { originalType: m.type, errors: m.errors ?? [] },
  }
}

const STATUSES = new Set<DeliveryStatus>(['sent', 'delivered', 'read', 'failed'])

function parseStatus(s: WaStatus): StatusUpdate | null {
  if (!STATUSES.has(s.status as DeliveryStatus)) return null
  const e = s.errors?.[0]
  return {
    waMessageId: s.id,
    status: s.status as DeliveryStatus,
    timestamp: toDate(s.timestamp),
    recipientId: s.recipient_id,
    error: e
      ? {
          code: e.code ?? null,
          title: e.title ?? null,
          message: e.error_data?.details ?? e.message ?? null,
        }
      : null,
  }
}

/**
 * Extracts messages and delivery statuses for one phone number from a webhook payload.
 * Changes for other numbers on the same Meta app are ignored.
 */
export function parseWebhook(payload: unknown, phoneNumberId: string | null): ParsedWebhook {
  const result: ParsedWebhook = { messages: [], statuses: [] }
  const p = payload as WaPayload
  if (p?.object !== 'whatsapp_business_account') return result

  for (const entry of p.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages' || !change.value) continue
      const value = change.value
      if (phoneNumberId && value.metadata?.phone_number_id !== phoneNumberId) continue

      const names = new Map((value.contacts ?? []).map((c) => [c.wa_id, c.profile?.name ?? null]))
      for (const m of value.messages ?? []) {
        const parsed = parseMessage(m, names.get(m.from) ?? null)
        if (parsed) result.messages.push(parsed)
      }
      for (const s of value.statuses ?? []) {
        const parsed = parseStatus(s)
        if (parsed) result.statuses.push(parsed)
      }
    }
  }

  result.messages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
  return result
}

/** Short text for the conversation list. */
export function messagePreview(type: MessageType, body: string | null): string {
  if (body) return body.slice(0, 140)
  const labels: Partial<Record<MessageType, string>> = {
    IMAGE: '📷',
    VIDEO: '🎥',
    AUDIO: '🎤',
    DOCUMENT: '📄',
    STICKER: '🏷️',
    LOCATION: '📍',
    CONTACTS: '👤',
    TEMPLATE: '📝',
  }
  return labels[type] ?? '…'
}
