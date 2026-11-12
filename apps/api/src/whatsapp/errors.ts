/**
 * Error from the WhatsApp Cloud API (or the network on the way to it).
 * `retryable` tells the send queue whether trying again can succeed (NFR-05).
 */
export class WhatsAppApiError extends Error {
  readonly name = 'WhatsAppApiError'

  constructor(
    message: string,
    readonly details: {
      httpStatus?: number
      code?: number
      title?: string
      detail?: string
      fbtraceId?: string
      network?: boolean
    } = {},
  ) {
    super(message)
  }

  get code(): number | undefined {
    return this.details.code
  }

  get retryable(): boolean {
    return isRetryable(this.details)
  }

  /** Safe to store and show to agents: never includes the access token. */
  toJSON() {
    return {
      code: this.details.code ?? null,
      title: this.details.title ?? null,
      message: this.details.detail ?? this.message,
      httpStatus: this.details.httpStatus ?? null,
    }
  }
}

/**
 * Error codes worth retrying with back-off: throttling and temporary outages.
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes
 */
const RETRYABLE_CODES = new Set([
  1, // API unknown (temporary)
  2, // API service (temporary downtime)
  4, // Application request limit reached
  80007, // WABA rate limit
  130429, // Cloud API throughput reached
  131000, // Something went wrong
  131016, // Service unavailable
  131056, // Pair rate limit (same sender/recipient)
  133004, // Server temporarily unavailable
])

/** Codes that mean "do not retry": the message can never be delivered as sent. */
export const NON_RETRYABLE_HINTS: Record<number, string> = {
  131047: 'More than 24 hours since the customer last replied; send a template instead.',
  131026: 'The message could not be delivered to this number.',
  131051: 'This message type is not supported.',
  190: 'The access token is invalid or expired. Reconnect WhatsApp in Settings.',
}

function isRetryable(d: WhatsAppApiError['details']): boolean {
  if (d.network) return true
  if (d.code !== undefined && RETRYABLE_CODES.has(d.code)) return true
  if (d.code === undefined && d.httpStatus !== undefined) {
    return d.httpStatus === 429 || d.httpStatus >= 500
  }
  return false
}
