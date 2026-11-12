import type { Cipher } from '../lib/crypto.js'
import type { Db } from '../lib/db.js'

/** Well-known setting keys. Keys listed in SECRET_KEYS are always encrypted. */
export const SettingKey = {
  SetupCompletedAt: 'setup.completed_at',
  Business: 'business',
  WhatsAppPhoneNumberId: 'whatsapp.phone_number_id',
  WhatsAppWabaId: 'whatsapp.waba_id',
  WhatsAppAccessToken: 'whatsapp.access_token',
  WhatsAppAppSecret: 'whatsapp.app_secret',
  WhatsAppVerifyToken: 'whatsapp.verify_token',
  WhatsAppFirstWebhookAt: 'whatsapp.first_webhook_at',
  WhatsAppPhone: 'whatsapp.phone',
  InboxSettings: 'inbox.settings',
} as const
export type SettingKey = (typeof SettingKey)[keyof typeof SettingKey]

const SECRET_KEYS = new Set<string>([
  SettingKey.WhatsAppAccessToken,
  SettingKey.WhatsAppAppSecret,
  SettingKey.WhatsAppVerifyToken,
])

/**
 * The API and the worker are separate processes, so cached values expire quickly
 * to pick up changes made by the other process (e.g. a new WhatsApp token).
 */
const CACHE_TTL_MS = 15_000

export class SettingsService {
  private cache = new Map<string, { value: string | null; expiresAt: number }>()

  constructor(
    private readonly db: Db,
    private readonly cipher: Cipher,
  ) {}

  async get(key: string): Promise<string | null> {
    const cached = this.cache.get(key)
    if (cached && cached.expiresAt > Date.now()) return cached.value
    const row = await this.db.setting.findUnique({ where: { key } })
    const value = row ? (row.encrypted ? this.cipher.decrypt(row.value) : row.value) : null
    this.remember(key, value)
    return value
  }

  private remember(key: string, value: string | null) {
    this.cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS })
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.get(key)
    return raw === null ? null : (JSON.parse(raw) as T)
  }

  async set(key: string, value: string): Promise<void> {
    const encrypted = SECRET_KEYS.has(key)
    const stored = encrypted ? this.cipher.encrypt(value) : value
    await this.db.setting.upsert({
      where: { key },
      create: { key, value: stored, encrypted },
      update: { value: stored, encrypted },
    })
    this.remember(key, value)
  }

  async setJson(key: string, value: unknown): Promise<void> {
    await this.set(key, JSON.stringify(value))
  }

  async delete(key: string): Promise<void> {
    await this.db.setting.deleteMany({ where: { key } })
    this.cache.delete(key)
  }

  /** Drops the in-memory cache, e.g. after another process changed settings. */
  invalidate(key?: string): void {
    if (key) this.cache.delete(key)
    else this.cache.clear()
  }
}
