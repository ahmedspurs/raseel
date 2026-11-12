export type ConversationStatus = 'OPEN' | 'PENDING' | 'CLOSED'
export type MessageStatus = 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'RECEIVED'

export interface ConversationSummary {
  id: string
  status: ConversationStatus
  assigneeId: string | null
  teamId: string | null
  unreadCount: number
  lastMessageAt: string | null
  lastMessagePreview: string | null
  lastInboundAt: string | null
  windowClosesAt: string | null
  windowOpen: boolean
  contact: { id: string; waId: string; name: string | null }
}

export interface InboxMessage {
  id: string
  direction: 'INBOUND' | 'OUTBOUND'
  type:
    | 'TEXT'
    | 'IMAGE'
    | 'VIDEO'
    | 'AUDIO'
    | 'DOCUMENT'
    | 'STICKER'
    | 'LOCATION'
    | 'CONTACTS'
    | 'REACTION'
    | 'INTERACTIVE'
    | 'BUTTON'
    | 'TEMPLATE'
    | 'UNSUPPORTED'
  body: string | null
  payload: Record<string, unknown> | null
  status: MessageStatus
  error: { code: number | null; title: string | null; message: string | null } | null
  media: {
    url: string | null
    pending: boolean
    mime: string | null
    filename: string | null
  } | null
  replyTo: { id: string; body: string | null; type: string } | null
  sentBy: { id: string; name: string } | null
  createdAt: string
}
