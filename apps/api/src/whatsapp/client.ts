import { WhatsAppApiError } from './errors.js'

export interface WhatsAppClientOptions {
  baseUrl: string
  version: string
  accessToken: string
  phoneNumberId: string
  /** Injected for tests; defaults to global fetch. */
  fetch?: typeof fetch
  timeoutMs?: number
}

export interface PhoneNumberInfo {
  id: string
  displayPhoneNumber: string
  verifiedName: string
  qualityRating: string | null
}

/** A message template as returned by the WhatsApp Business Management API. */
export interface MetaTemplate {
  id: string
  name: string
  language: string
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION'
  status: string
  components: Record<string, unknown>[]
  rejected_reason?: string
}

export interface MediaInfo {
  url: string
  mimeType: string
  fileSize: number | null
  sha256: string | null
}

/** Body of a message as accepted by POST /{phone-number-id}/messages (without envelope). */
export type OutboundMessage =
  | { type: 'text'; text: { body: string; preview_url?: boolean } }
  | { type: 'image'; image: { id: string; caption?: string } }
  | { type: 'video'; video: { id: string; caption?: string } }
  | { type: 'audio'; audio: { id: string } }
  | { type: 'document'; document: { id: string; caption?: string; filename?: string } }
  | { type: 'sticker'; sticker: { id: string } }
  | { type: 'reaction'; reaction: { message_id: string; emoji: string } }
  | { type: 'template'; template: Record<string, unknown> }

interface GraphErrorBody {
  error?: {
    message?: string
    type?: string
    code?: number
    error_user_title?: string
    error_user_msg?: string
    error_data?: { details?: string }
    fbtrace_id?: string
  }
}

/**
 * Thin client for the WhatsApp Cloud API. All Meta calls go through here so an
 * API change only touches this module (SRS §7.6).
 */
export class WhatsAppClient {
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number

  constructor(private readonly opts: WhatsAppClientOptions) {
    this.fetchImpl = opts.fetch ?? fetch
    this.timeoutMs = opts.timeoutMs ?? 20_000
  }

  private url(path: string): string {
    return `${this.opts.baseUrl.replace(/\/$/, '')}/${this.opts.version}/${path.replace(/^\//, '')}`
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.opts.accessToken}` }
    let payload: FormData | string | undefined
    if (body instanceof FormData) {
      payload = body
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
      payload = JSON.stringify(body)
    }

    let res: Response
    try {
      res = await this.fetchImpl(this.url(path), {
        method,
        headers,
        body: payload,
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (err) {
      throw new WhatsAppApiError(`Network error calling WhatsApp: ${(err as Error).message}`, {
        network: true,
      })
    }

    const text = await res.text()
    let json: unknown = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      // Non-JSON error pages (e.g. a proxy 502).
    }

    if (!res.ok || (json as GraphErrorBody | null)?.error) {
      const e = (json as GraphErrorBody | null)?.error
      throw new WhatsAppApiError(e?.message ?? `WhatsApp API returned HTTP ${res.status}`, {
        httpStatus: res.status,
        code: e?.code,
        title: e?.error_user_title ?? e?.type,
        detail: e?.error_data?.details ?? e?.error_user_msg ?? e?.message,
        fbtraceId: e?.fbtrace_id,
      })
    }
    return json as T
  }

  /** Used to verify credentials when connecting (FR-02). */
  async getPhoneNumber(): Promise<PhoneNumberInfo> {
    const res = await this.request<{
      id: string
      display_phone_number: string
      verified_name: string
      quality_rating?: string
    }>('GET', `${this.opts.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`)
    return {
      id: res.id,
      displayPhoneNumber: res.display_phone_number,
      verifiedName: res.verified_name,
      qualityRating: res.quality_rating ?? null,
    }
  }

  async getBusinessAccount(wabaId: string): Promise<{ id: string; name: string | null }> {
    const res = await this.request<{ id: string; name?: string }>('GET', `${wabaId}?fields=id,name`)
    return { id: res.id, name: res.name ?? null }
  }

  async sendMessage(
    to: string,
    message: OutboundMessage,
    opts: { replyToWaId?: string } = {},
  ): Promise<{ waMessageId: string }> {
    const res = await this.request<{ messages?: { id: string }[] }>(
      'POST',
      `${this.opts.phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        ...(opts.replyToWaId ? { context: { message_id: opts.replyToWaId } } : {}),
        ...message,
      },
    )
    const id = res.messages?.[0]?.id
    if (!id) throw new WhatsAppApiError('WhatsApp accepted the request but returned no message id')
    return { waMessageId: id }
  }

  // ── Message templates (FR-40) ──

  async listTemplates(wabaId: string): Promise<MetaTemplate[]> {
    const fields = 'id,name,language,category,status,components,rejected_reason'
    const all: MetaTemplate[] = []
    let after: string | undefined
    for (let page = 0; page < 50; page++) {
      const res = await this.request<{
        data: MetaTemplate[]
        paging?: { cursors?: { after?: string }; next?: string }
      }>(
        'GET',
        `${wabaId}/message_templates?fields=${fields}&limit=100${after ? `&after=${encodeURIComponent(after)}` : ''}`,
      )
      all.push(...res.data)
      after = res.paging?.next ? res.paging.cursors?.after : undefined
      if (!after) break
    }
    return all
  }

  async createTemplate(
    wabaId: string,
    template: { name: string; language: string; category: string; components: unknown[] },
  ): Promise<{ id: string; status: string; category: string }> {
    return this.request('POST', `${wabaId}/message_templates`, template)
  }

  async deleteTemplate(wabaId: string, name: string): Promise<void> {
    await this.request('DELETE', `${wabaId}/message_templates?name=${encodeURIComponent(name)}`)
  }

  /** Marks an inbound message as read so the customer sees blue ticks. */
  async markRead(waMessageId: string): Promise<void> {
    await this.request('POST', `${this.opts.phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: waMessageId,
    })
  }

  async uploadMedia(
    data: Uint8Array<ArrayBuffer>,
    mimeType: string,
    filename: string,
  ): Promise<string> {
    const form = new FormData()
    form.append('messaging_product', 'whatsapp')
    form.append('type', mimeType)
    form.append('file', new Blob([data], { type: mimeType }), filename)
    const res = await this.request<{ id: string }>('POST', `${this.opts.phoneNumberId}/media`, form)
    return res.id
  }

  async getMedia(mediaId: string): Promise<MediaInfo> {
    const res = await this.request<{
      url: string
      mime_type: string
      file_size?: number
      sha256?: string
    }>('GET', mediaId)
    return {
      url: res.url,
      mimeType: res.mime_type,
      fileSize: res.file_size ?? null,
      sha256: res.sha256 ?? null,
    }
  }

  /** Media URLs are short-lived and require the same bearer token. */
  async downloadMedia(url: string, maxBytes: number): Promise<Uint8Array<ArrayBuffer>> {
    let res: Response
    try {
      res = await this.fetchImpl(url, {
        headers: { Authorization: `Bearer ${this.opts.accessToken}` },
        signal: AbortSignal.timeout(60_000),
      })
    } catch (err) {
      throw new WhatsAppApiError(`Network error downloading media: ${(err as Error).message}`, {
        network: true,
      })
    }
    if (!res.ok) {
      throw new WhatsAppApiError(`Media download failed with HTTP ${res.status}`, {
        httpStatus: res.status,
      })
    }
    const declared = Number(res.headers.get('content-length') ?? 0)
    if (declared > maxBytes) throw new WhatsAppApiError('Media file is larger than allowed')
    const buf = new Uint8Array(await res.arrayBuffer())
    if (buf.byteLength > maxBytes) throw new WhatsAppApiError('Media file is larger than allowed')
    return buf
  }
}
