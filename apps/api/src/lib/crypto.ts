import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto'

const ALGO = 'aes-256-gcm'
const VERSION = 'v1'

/** Accepts a 32-byte key encoded as base64 or hex. */
export function parseKey(raw: string): Buffer {
  const candidates = [Buffer.from(raw, 'base64'), Buffer.from(raw, 'hex')]
  const key = candidates.find((b) => b.length === 32)
  if (!key) throw new Error('ENCRYPTION_KEY must be 32 bytes encoded as base64 or hex')
  return key
}

/**
 * Authenticated encryption for secrets stored in the database (NFR-08).
 * Output format: v1:<iv>:<tag>:<ciphertext>, each part base64url.
 */
export class Cipher {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error('Cipher key must be 32 bytes')
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12)
    const cipher = createCipheriv(ALGO, this.key, iv)
    const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    return [VERSION, iv, tag, data].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join(':')
  }

  decrypt(payload: string): string {
    const [version, iv, tag, data] = payload.split(':')
    if (version !== VERSION || !iv || !tag || data === undefined) {
      throw new Error('Unsupported encrypted payload')
    }
    const decipher = createDecipheriv(ALGO, this.key, Buffer.from(iv, 'base64url'))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  }
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url')
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

/** Shows only the last 4 characters of a secret, for UI and logs. */
export function maskSecret(secret: string | null | undefined): string | null {
  if (!secret) return null
  if (secret.length <= 8) return '••••'
  return `••••${secret.slice(-4)}`
}
