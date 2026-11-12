import type { Config } from '../config.js'
import { randomToken } from '../lib/crypto.js'
import { WhatsAppClient } from '../whatsapp/client.js'
import { WhatsAppApiError } from '../whatsapp/errors.js'
import { SettingKey, type SettingsService } from './settings.js'

export interface WhatsAppCredentials {
  phoneNumberId: string
  wabaId: string
  accessToken: string
  appSecret: string | null
}

/** Loads the WhatsApp connection from encrypted settings and builds API clients. */
export class WhatsAppService {
  constructor(
    private readonly settings: SettingsService,
    private readonly config: Config,
    private readonly fetchImpl?: typeof fetch,
  ) {}

  async credentials(): Promise<WhatsAppCredentials | null> {
    const [phoneNumberId, wabaId, accessToken, appSecret] = await Promise.all([
      this.settings.get(SettingKey.WhatsAppPhoneNumberId),
      this.settings.get(SettingKey.WhatsAppWabaId),
      this.settings.get(SettingKey.WhatsAppAccessToken),
      this.settings.get(SettingKey.WhatsAppAppSecret),
    ])
    if (!phoneNumberId || !wabaId || !accessToken) return null
    return { phoneNumberId, wabaId, accessToken, appSecret }
  }

  clientFor(creds: Pick<WhatsAppCredentials, 'accessToken' | 'phoneNumberId'>): WhatsAppClient {
    return new WhatsAppClient({
      baseUrl: this.config.WHATSAPP_GRAPH_URL,
      version: this.config.WHATSAPP_API_VERSION,
      accessToken: creds.accessToken,
      phoneNumberId: creds.phoneNumberId,
      fetch: this.fetchImpl,
    })
  }

  /** Client for the connected number; throws a non-retryable error when not connected. */
  async client(): Promise<WhatsAppClient> {
    const creds = await this.credentials()
    if (!creds) {
      throw new WhatsAppApiError('WhatsApp is not connected', { code: -1, title: 'not_connected' })
    }
    return this.clientFor(creds)
  }

  /** FR-03: token Meta echoes back when verifying the webhook URL. */
  async verifyToken(): Promise<string> {
    const existing = await this.settings.get(SettingKey.WhatsAppVerifyToken)
    if (existing) return existing
    const token = randomToken(24)
    await this.settings.set(SettingKey.WhatsAppVerifyToken, token)
    return token
  }

  webhookUrl(): string {
    return `${this.config.APP_URL.replace(/\/$/, '')}/webhooks/whatsapp`
  }
}
