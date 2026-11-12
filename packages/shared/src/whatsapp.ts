import { z } from 'zod'

/** Free-form replies are allowed for 24 hours after the customer's last message (FR-13). */
export const CUSTOMER_WINDOW_MS = 24 * 60 * 60 * 1000

export interface CustomerWindow {
  open: boolean
  /** When the window closes; null if the customer never wrote. */
  closesAt: Date | null
  /** Milliseconds left; 0 when closed. */
  remainingMs: number
}

export function customerWindow(
  lastInboundAt: Date | string | null | undefined,
  now: Date = new Date(),
): CustomerWindow {
  if (!lastInboundAt) return { open: false, closesAt: null, remainingMs: 0 }
  const closesAt = new Date(new Date(lastInboundAt).getTime() + CUSTOMER_WINDOW_MS)
  const remainingMs = Math.max(0, closesAt.getTime() - now.getTime())
  return { open: remainingMs > 0, closesAt, remainingMs }
}

/** FR-02: credentials from the Meta app. The token may be omitted to keep the saved one. */
export const whatsappSettingsSchema = z.object({
  phoneNumberId: z
    .string()
    .trim()
    .regex(/^\d{5,25}$/, 'Phone Number ID is numeric'),
  wabaId: z
    .string()
    .trim()
    .regex(/^\d{5,25}$/, 'WhatsApp Business Account ID is numeric'),
  accessToken: z.string().trim().min(20).max(1000).optional(),
  appSecret: z
    .string()
    .trim()
    .regex(/^[a-f0-9]{32}$/i, 'App secret is 32 hexadecimal characters')
    .optional(),
})
export type WhatsAppSettingsInput = z.infer<typeof whatsappSettingsSchema>

export const sendTextSchema = z.object({
  type: z.literal('text'),
  body: z.string().trim().min(1).max(4096),
  replyToMessageId: z.string().optional(),
})
export type SendTextInput = z.infer<typeof sendTextSchema>

/** WhatsApp media limits (Cloud API "supported media types"). */
export const MEDIA_LIMITS = {
  image: { mimes: ['image/jpeg', 'image/png'], maxBytes: 5 * 1024 * 1024 },
  video: { mimes: ['video/mp4', 'video/3gpp'], maxBytes: 16 * 1024 * 1024 },
  audio: {
    mimes: ['audio/aac', 'audio/amr', 'audio/mpeg', 'audio/mp4', 'audio/ogg'],
    maxBytes: 16 * 1024 * 1024,
  },
  sticker: { mimes: ['image/webp'], maxBytes: 500 * 1024 },
  document: { mimes: [] as string[], maxBytes: 100 * 1024 * 1024 },
} as const
export type OutboundMediaKind = keyof typeof MEDIA_LIMITS

/** Picks how a file is sent: as a native image/video/audio when supported, otherwise as a document. */
export function mediaKindFor(mime: string): Exclude<OutboundMediaKind, 'sticker'> {
  const base = mime.split(';')[0]?.trim().toLowerCase() ?? ''
  for (const kind of ['image', 'video', 'audio'] as const) {
    if ((MEDIA_LIMITS[kind].mimes as readonly string[]).includes(base)) return kind
  }
  return 'document'
}
