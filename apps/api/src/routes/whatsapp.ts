import { whatsappSettingsSchema } from '@raseel/shared'
import type { FastifyPluginAsync } from 'fastify'
import { maskSecret } from '../lib/crypto.js'
import { currentUser, requireAuth, requirePermission } from '../plugins/auth.js'
import { SettingKey } from '../services/settings.js'
import type { PhoneNumberInfo } from '../whatsapp/client.js'
import { WhatsAppApiError } from '../whatsapp/errors.js'

const WHATSAPP_KEYS = [
  SettingKey.WhatsAppPhoneNumberId,
  SettingKey.WhatsAppWabaId,
  SettingKey.WhatsAppAccessToken,
  SettingKey.WhatsAppAppSecret,
  SettingKey.WhatsAppPhone,
  SettingKey.WhatsAppFirstWebhookAt,
]

/** FR-02, FR-03: connect the WhatsApp number and show the webhook details for Meta. */
export const whatsappRoutes: FastifyPluginAsync = async (app) => {
  const { settings, whatsapp, audit } = app.ctx

  /** Lightweight status for every signed-in user (inbox banner). */
  app.get('/status', { preHandler: requireAuth }, async () => {
    const creds = await whatsapp.credentials()
    const phone = await settings.getJson<PhoneNumberInfo>(SettingKey.WhatsAppPhone)
    return {
      connected: creds !== null,
      displayPhoneNumber: phone?.displayPhoneNumber ?? null,
      verifiedName: phone?.verifiedName ?? null,
    }
  })

  app.get('/settings', { preHandler: requirePermission('whatsapp:manage') }, async () => {
    const creds = await whatsapp.credentials()
    const [phone, firstWebhookAt, verifyToken] = await Promise.all([
      settings.getJson<PhoneNumberInfo>(SettingKey.WhatsAppPhone),
      settings.get(SettingKey.WhatsAppFirstWebhookAt),
      whatsapp.verifyToken(),
    ])
    return {
      connected: creds !== null,
      phoneNumberId: creds?.phoneNumberId ?? null,
      wabaId: creds?.wabaId ?? null,
      // NFR-08: secrets are never returned in full.
      accessToken: maskSecret(creds?.accessToken),
      appSecretSet: Boolean(creds?.appSecret),
      phone,
      webhook: { url: whatsapp.webhookUrl(), verifyToken, firstReceivedAt: firstWebhookAt },
    }
  })

  app.put(
    '/settings',
    {
      preHandler: requirePermission('whatsapp:manage'),
      config: { rateLimit: { max: 20, timeWindow: '15 minutes' } },
    },
    async (req, reply) => {
      const input = whatsappSettingsSchema.parse(req.body)
      const existing = await whatsapp.credentials()
      const accessToken = input.accessToken ?? existing?.accessToken
      const appSecret = input.appSecret ?? existing?.appSecret ?? null
      if (!accessToken) return reply.code(400).send({ error: 'access_token_required' })
      if (!appSecret) return reply.code(400).send({ error: 'app_secret_required' })

      // Verify the credentials against the Cloud API before saving them.
      const client = whatsapp.clientFor({ accessToken, phoneNumberId: input.phoneNumberId })
      let phone: PhoneNumberInfo
      try {
        phone = await client.getPhoneNumber()
        await client.getBusinessAccount(input.wabaId)
      } catch (err) {
        const detail = err instanceof WhatsAppApiError ? err.toJSON() : null
        return reply.code(422).send({ error: 'whatsapp_verification_failed', detail })
      }

      await settings.set(SettingKey.WhatsAppPhoneNumberId, input.phoneNumberId)
      await settings.set(SettingKey.WhatsAppWabaId, input.wabaId)
      await settings.set(SettingKey.WhatsAppAccessToken, accessToken)
      await settings.set(SettingKey.WhatsAppAppSecret, appSecret)
      await settings.setJson(SettingKey.WhatsAppPhone, phone)

      await audit.log({
        userId: currentUser(req).id,
        action: 'whatsapp.connected',
        target: input.phoneNumberId,
        meta: { displayPhoneNumber: phone.displayPhoneNumber },
        ip: req.ip,
      })
      return { connected: true, phone }
    },
  )

  app.delete('/settings', { preHandler: requirePermission('whatsapp:manage') }, async (req) => {
    for (const key of WHATSAPP_KEYS) await settings.delete(key)
    await audit.log({ userId: currentUser(req).id, action: 'whatsapp.disconnected', ip: req.ip })
    return { connected: false }
  })
}
