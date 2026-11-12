import argon2 from 'argon2'
import { generateSecret, generateURI, verify } from 'otplib'
import type { Config } from '../config.js'
import { type Cipher, randomToken, sha256 } from '../lib/crypto.js'
import type { Db, User } from '../lib/db.js'

export const SESSION_COOKIE = 'raseel_session'

/** Argon2id parameters sized for a 1 vCPU VPS (NFR-03, NFR-06). */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const

/** Used to keep login timing constant when the email does not exist. */
let dummyHash: Promise<string> | undefined

export type PublicUser = Pick<User, 'id' | 'name' | 'email' | 'role' | 'language' | 'active'> & {
  twoFactorEnabled: boolean
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    language: user.language,
    active: user.active,
    twoFactorEnabled: user.totpSecret !== null,
  }
}

export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly cipher: Cipher,
    private readonly config: Config,
  ) {}

  hashPassword(password: string): Promise<string> {
    return argon2.hash(password, ARGON2_OPTIONS)
  }

  async verifyPassword(hash: string | null, password: string): Promise<boolean> {
    if (!hash) {
      dummyHash ??= this.hashPassword('raseel-timing-guard')
      await argon2.verify(await dummyHash, password).catch(() => false)
      return false
    }
    return argon2.verify(hash, password).catch(() => false)
  }

  async createSession(userId: string, meta: { userAgent?: string; ip?: string }) {
    const token = randomToken(32)
    const expiresAt = new Date(Date.now() + this.config.SESSION_TTL_DAYS * 86_400_000)
    await this.db.session.create({
      data: {
        id: randomToken(12),
        userId,
        tokenHash: sha256(token),
        userAgent: meta.userAgent?.slice(0, 300),
        ip: meta.ip,
        expiresAt,
      },
    })
    return { token, expiresAt }
  }

  /** Resolves a session token to an active user, sliding lastSeenAt at most once a minute. */
  async resolveSession(token: string) {
    const session = await this.db.session.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true },
    })
    if (!session) return null
    if (session.expiresAt < new Date() || !session.user.active) {
      await this.db.session.delete({ where: { id: session.id } }).catch(() => undefined)
      return null
    }
    if (Date.now() - session.lastSeenAt.getTime() > 60_000) {
      await this.db.session.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date() },
      })
    }
    return session
  }

  async destroySession(token: string): Promise<void> {
    await this.db.session.deleteMany({ where: { tokenHash: sha256(token) } })
  }

  async destroyAllSessions(userId: string, exceptSessionId?: string): Promise<void> {
    await this.db.session.deleteMany({
      where: { userId, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    })
  }

  // ── TOTP two-factor authentication (NFR-06) ──

  newTotpSecret(email: string) {
    const secret = generateSecret()
    const uri = generateURI({ issuer: 'Raseel', label: email, secret })
    return { secret, uri }
  }

  encryptTotpSecret(secret: string): string {
    return this.cipher.encrypt(secret)
  }

  async verifyTotp(encryptedOrPlainSecret: string, token: string, encrypted = true) {
    const secret = encrypted ? this.cipher.decrypt(encryptedOrPlainSecret) : encryptedOrPlainSecret
    try {
      const result = await verify({ secret, token })
      return result.valid
    } catch {
      return false
    }
  }
}
