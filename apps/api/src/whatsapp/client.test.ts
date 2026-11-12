import { describe, expect, it, vi } from 'vitest'
import { WhatsAppClient } from './client.js'
import { WhatsAppApiError } from './errors.js'

function clientWith(responder: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) =>
    responder(String(input), init ?? {}),
  )
  const client = new WhatsAppClient({
    baseUrl: 'https://graph.test',
    version: 'v26.0',
    accessToken: 'EAAG-secret-token',
    phoneNumberId: '111',
    fetch: fetchMock as unknown as typeof fetch,
  })
  return { client, fetchMock }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('WhatsAppClient', () => {
  it('sends a text message with the right envelope and auth', async () => {
    const { client, fetchMock } = clientWith(() =>
      json({ messaging_product: 'whatsapp', messages: [{ id: 'wamid.ABC' }] }),
    )
    const res = await client.sendMessage(
      '966500000001',
      { type: 'text', text: { body: 'مرحبا' } },
      { replyToWaId: 'wamid.PREV' },
    )
    expect(res.waMessageId).toBe('wamid.ABC')

    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('https://graph.test/v26.0/111/messages')
    expect((init!.headers as Record<string, string>).Authorization).toBe('Bearer EAAG-secret-token')
    expect(JSON.parse(init!.body as string)).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '966500000001',
      context: { message_id: 'wamid.PREV' },
      type: 'text',
      text: { body: 'مرحبا' },
    })
  })

  it('classifies throttling errors as retryable', async () => {
    const { client } = clientWith(() =>
      json({ error: { message: 'Rate limit hit', code: 130429, fbtrace_id: 'x' } }, 400),
    )
    const err = await client
      .sendMessage('1', { type: 'text', text: { body: 'hi' } })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(WhatsAppApiError)
    expect((err as WhatsAppApiError).retryable).toBe(true)
    expect((err as WhatsAppApiError).code).toBe(130429)
  })

  it('treats the closed 24-hour window as permanent', async () => {
    const { client } = clientWith(() =>
      json(
        {
          error: {
            message: 'Re-engagement message',
            code: 131047,
            error_data: {
              details: 'Message failed to send because more than 24 hours have passed',
            },
          },
        },
        400,
      ),
    )
    const err = (await client
      .sendMessage('1', { type: 'text', text: { body: 'hi' } })
      .catch((e: unknown) => e)) as WhatsAppApiError
    expect(err.retryable).toBe(false)
    expect(err.toJSON()).toMatchObject({
      code: 131047,
      message: expect.stringContaining('24 hours'),
    })
  })

  it('retries network failures and 5xx without a Graph error body', async () => {
    const network = clientWith(() => {
      throw new TypeError('fetch failed')
    })
    const e1 = (await network.client.getPhoneNumber().catch((e: unknown) => e)) as WhatsAppApiError
    expect(e1.retryable).toBe(true)

    const gateway = clientWith(() => new Response('<html>Bad gateway</html>', { status: 502 }))
    const e2 = (await gateway.client.getPhoneNumber().catch((e: unknown) => e)) as WhatsAppApiError
    expect(e2.retryable).toBe(true)
  })

  it('never puts the access token in serialized errors', async () => {
    const { client } = clientWith(() =>
      json({ error: { message: 'Invalid OAuth', code: 190 } }, 401),
    )
    const err = (await client.getPhoneNumber().catch((e: unknown) => e)) as WhatsAppApiError
    expect(JSON.stringify(err.toJSON())).not.toContain('EAAG-secret-token')
    expect(err.retryable).toBe(false)
  })

  it('maps phone number info', async () => {
    const { client } = clientWith(() =>
      json({
        id: '111',
        display_phone_number: '+966 50 000 0000',
        verified_name: 'Al Noor Clinic',
        quality_rating: 'GREEN',
      }),
    )
    expect(await client.getPhoneNumber()).toEqual({
      id: '111',
      displayPhoneNumber: '+966 50 000 0000',
      verifiedName: 'Al Noor Clinic',
      qualityRating: 'GREEN',
    })
  })

  it('refuses media larger than the limit', async () => {
    const { client } = clientWith(
      () => new Response(new Uint8Array(10), { headers: { 'content-length': '10' } }),
    )
    await expect(client.downloadMedia('https://media.test/x', 5)).rejects.toThrow('larger')
  })
})
