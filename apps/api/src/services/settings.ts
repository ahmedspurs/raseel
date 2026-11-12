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
  AutoAssign: 'inbox.auto_assign',
  AutoAssignCursor: 'inbox.auto_assign_cursor',
} as const
export type SettingKey = (typeof SettingKey)[keyof typeof SettingKey]

const SECRET_KEYS = new Set<string>([
  SettingKey.WhatsAppAccessToken,
  SettingKey.WhatsAppAppSecret,
  SettingKey.WhatsAppVerifyToken,
])

export class SettingsService {
  private cache = new Map<string, string | null>()

  constructor(
    private readonly db: Db,
    private readonly cipher: Cipher,
  ) {}

  async get(key: string): Promise<string | null> {
    if (this.cache.has(key)) return this.cache.get(key) ?? null
    const row = await this.db.setting.findUnique({ where: { key } })
    const value = row ? (row.encrypted ? this.cipher.decrypt(row.value) : row.value) : null
    this.cache.set(key, value)
    return value
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
    this.cache.set(key, value)
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
