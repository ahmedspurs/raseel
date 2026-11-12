import { randomBytes } from 'node:crypto'
import multipart from '@fastify/multipart'
import Fastify, { type FastifyInstance } from 'fastify'
import { fakeWamid, statusPayload } from '../whatsapp/fixtures.js'
import { signWebhookBody } from '../whatsapp/signature.js'

/**
 * A small stand-in for Meta's Graph API, for tests and for trying Raseel without a
 * Meta account. It implements just what Raseel calls: phone number and WABA lookups,
 * sending messages, uploading and downloading media.
 */
export interface MockGraphOptions {
  phoneNumberId?: string
  wabaId?: string
  accessToken?: string
  /** When set, delivery statuses are posted back to this webhook, signed with appSecret. */
  webhookUrl?: string
  appSecret?: string
  statusDelayMs?: number
}

export interface SentMessage {
  waMessageId: string
  to: string
  type: string
  body: Record<string, unknown>
}

interface StoredMedia {
  data: Buffer
  mime: string
  filename: string
}

interface InjectedFailure {
  code: number
  message: string
  httpStatus?: number
}

export class MockGraph {
  readonly phoneNumberId: string
  readonly wabaId: string
  readonly accessToken: string
  readonly sent: SentMessage[] = []
  readonly reads: string[] = []
  readonly media = new Map<string, StoredMedia>()
  readonly templates: {
    id: string
    name: string
    language: string
    category: string
    status: string
    components: unknown[]
  }[] = []
  private failures: InjectedFailure[] = []
  private app: FastifyInstance | null = null
  url = ''

  constructor(private readonly opts: MockGraphOptions = {}) {
    this.phoneNumberId = opts.phoneNumberId ?? '100000000000001'
    this.wabaId = opts.wabaId ?? '200000000000001'
    this.accessToken = opts.accessToken ?? 'mock-access-token-for-local-development'
  }

  /** The next send attempts fail with these Graph errors, in order. */
  failNext(...failures: InjectedFailure[]) {
    this.failures.push(...failures)
  }

  addMedia(data: Buffer, mime: string, filename = 'file'): string {
    const id = `media-${randomBytes(6).toString('hex')}`
    this.media.set(id, { data, mime, filename })
    return id
  }

  async start(port = 0, host = '127.0.0.1'): Promise<string> {
    const app = Fastify({ logger: false })
    await app.register(multipart)
    const graphError = (code: number, message: string) => ({
      error: { message, type: 'OAuthException', code, fbtrace_id: 'mock' },
    })

    app.addHook('onRequest', async (req, reply) => {
      if (req.url.startsWith('/__mock') || req.url.startsWith('/download/')) return
      if (req.headers.authorization !== `Bearer ${this.accessToken}`) {
        return reply.code(401).send(graphError(190, 'Invalid OAuth access token.'))
      }
    })

    app.get('/:version/:id', async (req, reply) => {
      const { id } = req.params as { id: string }
      if (id === this.phoneNumberId) {
        return {
          id,
          display_phone_number: '+1 555-000-0001',
          verified_name: 'Raseel Demo',
          quality_rating: 'GREEN',
        }
      }
      if (id === this.wabaId) return { id, name: 'Raseel Demo WABA' }
      const media = this.media.get(id)
      if (media) {
        return {
          id,
          url: `${this.url}/download/${id}`,
          mime_type: media.mime,
          file_size: media.data.byteLength,
          sha256: 'mock',
        }
      }
      return reply
        .code(400)
        .send(graphError(100, `Unsupported get request. Object ${id} does not exist`))
    })

    app.get('/:version/:waba/message_templates', async (req, reply) => {
      const { waba } = req.params as { waba: string }
      if (waba !== this.wabaId) return reply.code(400).send(graphError(100, 'Invalid parameter'))
      return { data: this.templates, paging: { cursors: {} } }
    })

    app.post('/:version/:waba/message_templates', async (req, reply) => {
      const { waba } = req.params as { waba: string }
      if (waba !== this.wabaId) return reply.code(400).send(graphError(100, 'Invalid parameter'))
      const body = req.body as {
        name: string
        language: string
        category: string
        components: unknown[]
      }
      if (this.templates.some((t) => t.name === body.name && t.language === body.language)) {
        return reply.code(400).send(graphError(100, 'Message template already exists'))
      }
      const t = { id: String(Date.now()), status: 'PENDING', ...body }
      this.templates.push(t)
      return { id: t.id, status: t.status, category: t.category }
    })

    app.delete('/:version/:waba/message_templates', async (req) => {
      const { name } = req.query as { name: string }
      for (let i = this.templates.length - 1; i >= 0; i--) {
        if (this.templates[i]!.name === name) this.templates.splice(i, 1)
      }
      return { success: true }
    })

    app.post('/:version/:pnid/messages', async (req, reply) => {
      const { pnid } = req.params as { pnid: string }
      if (pnid !== this.phoneNumberId)
        return reply.code(400).send(graphError(100, 'Invalid parameter'))
      const body = req.body as Record<string, unknown> & {
        to: string
        type: string
        status?: string
      }
      if (body.status === 'read') {
        this.reads.push(String(body.message_id))
        return { success: true }
      }
      const failure = this.failures.shift()
      if (failure) {
        return reply.code(failure.httpStatus ?? 400).send({
          error: {
            message: failure.message,
            code: failure.code,
            error_data: { details: failure.message },
            fbtrace_id: 'mock',
          },
        })
      }
      const waMessageId = fakeWamid()
      this.sent.push({ waMessageId, to: body.to, type: body.type, body })
      void this.reportStatuses(waMessageId, body.to)
      return {
        messaging_product: 'whatsapp',
        contacts: [{ input: body.to, wa_id: body.to }],
        messages: [{ id: waMessageId }],
      }
    })

    app.post('/:version/:pnid/media', async (req, reply) => {
      const file = await req.file()
      if (!file) return reply.code(400).send(graphError(100, 'file is required'))
      const data = await file.toBuffer()
      return { id: this.addMedia(data, file.mimetype, file.filename) }
    })

    app.get('/download/:id', async (req, reply) => {
      const { id } = req.params as { id: string }
      const media = this.media.get(id)
      if (!media) return reply.code(404).send()
      return reply.type(media.mime).send(media.data)
    })

    /** Registers a file so the simulator can reference it in an inbound media message. */
    app.post('/__mock/media', async (req, reply) => {
      const file = await req.file()
      if (!file) return reply.code(400).send({ error: 'file is required' })
      return { id: this.addMedia(await file.toBuffer(), file.mimetype, file.filename) }
    })

    const address = await app.listen({ port, host })
    this.app = app
    this.url = address
    return address
  }

  /** Mimics Meta: sent → delivered → read, each as a signed webhook. */
  private async reportStatuses(waMessageId: string, to: string) {
    const { webhookUrl, appSecret } = this.opts
    if (!webhookUrl || !appSecret) return
    const delay = this.opts.statusDelayMs ?? 800
    for (const status of ['sent', 'delivered', 'read'] as const) {
      await new Promise((r) => setTimeout(r, delay))
      const raw = JSON.stringify(statusPayload(this.phoneNumberId, waMessageId, to, status))
      await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-hub-signature-256': signWebhookBody(raw, appSecret),
        },
        body: raw,
      }).catch(() => undefined)
    }
  }

  async close() {
    await this.app?.close()
  }
}
