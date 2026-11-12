/**
 * Builders for WhatsApp webhook payloads in Meta's format. Used by tests, the
 * local webhook simulator and the mock Graph API, so all three stay consistent.
 */
let counter = 0
export const fakeWamid = () =>
  `wamid.RASEEL${Date.now().toString(36)}${(counter++).toString(36)}`.toUpperCase()

export interface Envelope {
  phoneNumberId: string
  from: string
  name?: string
}

const unix = (d: Date = new Date()) => String(Math.floor(d.getTime() / 1000))

function wrap(phoneNumberId: string, value: Record<string, unknown>) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA_ID',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550000000', phone_number_id: phoneNumberId },
              ...value,
            },
          },
        ],
      },
    ],
  }
}

export function inboundPayload(
  env: Envelope,
  message: Record<string, unknown> & { type: string },
  opts: { id?: string; at?: Date; contextId?: string } = {},
) {
  return wrap(env.phoneNumberId, {
    contacts: [{ wa_id: env.from, profile: { name: env.name ?? 'Customer' } }],
    messages: [
      {
        from: env.from,
        id: opts.id ?? fakeWamid(),
        timestamp: unix(opts.at),
        ...(opts.contextId ? { context: { from: env.from, id: opts.contextId } } : {}),
        ...message,
      },
    ],
  })
}

export const textMessage = (body: string) => ({ type: 'text', text: { body } })

export function statusPayload(
  phoneNumberId: string,
  waMessageId: string,
  recipientId: string,
  status: 'sent' | 'delivered' | 'read' | 'failed',
  error?: { code: number; title: string; details?: string },
) {
  return wrap(phoneNumberId, {
    statuses: [
      {
        id: waMessageId,
        status,
        timestamp: unix(),
        recipient_id: recipientId,
        ...(error
          ? {
              errors: [
                {
                  code: error.code,
                  title: error.title,
                  message: error.title,
                  error_data: { details: error.details ?? error.title },
                },
              ],
            }
          : {}),
      },
    ],
  })
}
