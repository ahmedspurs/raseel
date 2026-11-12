import type { FastifyPluginAsync } from 'fastify'
import { safeEqual } from '../lib/crypto.js'
import type { Prisma } from '../lib/db.js'
import { jobId } from '../lib/queues.js'
import { SettingKey } from '../services/settings.js'
import { verifyWebhookSignature } from '../whatsapp/signature.js'

/**
 * Meta's webhook endpoint. Events are verified (NFR-07), stored, acknowledged at once
 * and processed by the worker, so nothing is lost if the app restarts (NFR-04).
 */
export const webhookRoutes: FastifyPluginAsync = async (app) => {
  const { db, settings, whatsapp, queues } = app.ctx

  // Keep the raw bytes: the signature is computed over the exact body Meta sent.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) =>
    done(null, body),
  )

  /** FR-03: Meta calls this once when the webhook URL is saved in the Meta app. */
  app.get('/whatsapp', { config: { rateLimit: false } }, async (req, reply) => {
    const q = req.query as Record<string, string | undefined>
    const expected = await whatsapp.verifyToken()
    if (
      q['hub.mode'] === 'subscribe' &&
      q['hub.verify_token'] &&
      safeEqual(q['hub.verify_token'], expected)
    ) {
      return reply.type('text/plain').send(q['hub.challenge'] ?? '')
    }
    return reply.code(403).send({ error: 'verification_failed' })
  })

  app.post(
    '/whatsapp',
    { config: { rateLimit: false }, bodyLimit: 5 * 1024 * 1024 },
    async (req, reply) => {
      const raw = req.body as Buffer
      const creds = await whatsapp.credentials()
      if (!creds?.appSecret) return reply.code(503).send({ error: 'not_connected' })

      const signature = req.headers['x-hub-signature-256']
      if (
        !verifyWebhookSignature(
          raw,
          typeof signature === 'string' ? signature : undefined,
          creds.appSecret,
        )
      ) {
        req.log.warn('rejected webhook with invalid signature')
        return reply.code(401).send({ error: 'invalid_signature' })
      }

      let payload: Prisma.InputJsonValue
      try {
        payload = JSON.parse(raw.toString('utf8')) as Prisma.InputJsonValue
      } catch {
        return reply.code(400).send({ error: 'invalid_json' })
      }

      // Stored before acknowledging: if this fails, Meta retries the delivery.
      const event = await db.webhookEvent.create({ data: { payload } })

      if (!(await settings.get(SettingKey.WhatsAppFirstWebhookAt))) {
        await settings.set(SettingKey.WhatsAppFirstWebhookAt, new Date().toISOString())
      }

      // If Redis is briefly down, the maintenance sweep re-queues PENDING events.
      await queues.webhook
        .add('process', { eventId: event.id }, { jobId: jobId('webhook', event.id) })
        .catch((err: unknown) => req.log.error({ err }, 'failed to queue webhook event'))

      return reply.code(200).send('EVENT_RECEIVED')
    },
  )
}
