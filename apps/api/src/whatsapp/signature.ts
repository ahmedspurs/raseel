import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * NFR-07: Meta signs every webhook with HMAC-SHA256 of the raw body using the app secret,
 * sent as `X-Hub-Signature-256: sha256=<hex>`.
 */
export function verifyWebhookSignature(
  rawBody: Buffer,
  header: string | undefined,
  appSecret: string,
): boolean {
  if (!header?.startsWith('sha256=')) return false
  const received = Buffer.from(header.slice('sha256='.length), 'hex')
  const expected = createHmac('sha256', appSecret).update(rawBody).digest()
  return received.length === expected.length && timingSafeEqual(received, expected)
}

export function signWebhookBody(rawBody: Buffer | string, appSecret: string): string {
  return `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`
}
