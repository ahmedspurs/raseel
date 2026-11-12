import { describe, expect, it } from 'vitest'
import { inboundPayload, statusPayload, textMessage } from './fixtures.js'
import { messagePreview, parseWebhook } from './parse.js'
import { signWebhookBody, verifyWebhookSignature } from './signature.js'

const env = { phoneNumberId: 'PNID', from: '966500000001', name: 'سارة' }
const parseOne = (message: Record<string, unknown> & { type: string }, contextId?: string) =>
  parseWebhook(inboundPayload(env, message, { id: 'wamid.1', contextId }), 'PNID').messages[0]

describe('parseWebhook', () => {
  it('parses text with sender profile name and reply context', () => {
    const m = parseOne(textMessage('السلام عليكم'), 'wamid.prev')
    expect(m).toMatchObject({
      waMessageId: 'wamid.1',
      from: '966500000001',
      profileName: 'سارة',
      type: 'TEXT',
      body: 'السلام عليكم',
      replyToWaId: 'wamid.prev',
    })
    expect(m?.timestamp).toBeInstanceOf(Date)
  })

  it('parses media with caption, filename and voice flag', () => {
    expect(
      parseOne({ type: 'image', image: { id: 'm1', mime_type: 'image/jpeg', caption: 'فاتورة' } }),
    ).toMatchObject({ type: 'IMAGE', body: 'فاتورة', media: { id: 'm1', mimeType: 'image/jpeg' } })

    expect(
      parseOne({
        type: 'audio',
        audio: { id: 'a1', mime_type: 'audio/ogg; codecs=opus', voice: true },
      }),
    ).toMatchObject({ type: 'AUDIO', media: { id: 'a1', voice: true } })

    expect(
      parseOne({
        type: 'document',
        document: { id: 'd1', mime_type: 'application/pdf', filename: 'quote.pdf' },
      }),
    ).toMatchObject({ type: 'DOCUMENT', media: { filename: 'quote.pdf' } })

    expect(parseOne({ type: 'video', video: { id: 'v1' } })?.type).toBe('VIDEO')
    expect(parseOne({ type: 'sticker', sticker: { id: 's1', animated: true } })).toMatchObject({
      type: 'STICKER',
      payload: { animated: true },
    })
  })

  it('parses location and shared contacts', () => {
    expect(
      parseOne({
        type: 'location',
        location: { latitude: 24.7, longitude: 46.6, name: 'Kingdom Centre', address: 'Riyadh' },
      }),
    ).toMatchObject({
      type: 'LOCATION',
      body: 'Kingdom Centre — Riyadh',
      payload: { latitude: 24.7, longitude: 46.6 },
    })

    expect(
      parseOne({
        type: 'contacts',
        contacts: [
          { name: { formatted_name: 'Ali' }, phones: [{ phone: '+966 5', wa_id: '9665' }] },
        ],
      }),
    ).toMatchObject({ type: 'CONTACTS', body: 'Ali', payload: { contacts: [{ name: 'Ali' }] } })
  })

  it('parses reactions, including removal', () => {
    expect(
      parseOne({ type: 'reaction', reaction: { message_id: 'wamid.target', emoji: '👍' } }),
    ).toMatchObject({ type: 'REACTION', body: '👍', replyToWaId: 'wamid.target' })
    expect(parseOne({ type: 'reaction', reaction: { message_id: 'wamid.target' } })).toMatchObject({
      body: null,
      payload: { removed: true },
    })
  })

  it('parses button and list replies', () => {
    expect(
      parseOne({
        type: 'interactive',
        interactive: { type: 'button_reply', button_reply: { id: 'book', title: 'احجز موعد' } },
      }),
    ).toMatchObject({ type: 'INTERACTIVE', body: 'احجز موعد', payload: { id: 'book' } })
    expect(
      parseOne({
        type: 'interactive',
        interactive: { type: 'list_reply', list_reply: { id: 'riyadh', title: 'Riyadh' } },
      }),
    ).toMatchObject({ body: 'Riyadh', payload: { kind: 'list_reply' } })
    expect(parseOne({ type: 'button', button: { text: 'Stop', payload: 'STOP' } })).toMatchObject({
      type: 'BUTTON',
      body: 'Stop',
    })
  })

  it('keeps unknown types as UNSUPPORTED instead of dropping them', () => {
    expect(
      parseOne({ type: 'unsupported', errors: [{ code: 131051, title: 'Message type unknown' }] }),
    ).toMatchObject({ type: 'UNSUPPORTED', payload: { originalType: 'unsupported' } })
  })

  it('ignores welcome signals and other phone numbers', () => {
    expect(parseOne({ type: 'request_welcome' })).toBeUndefined()
    const other = inboundPayload({ ...env, phoneNumberId: 'OTHER' }, textMessage('hi'))
    expect(parseWebhook(other, 'PNID').messages).toHaveLength(0)
    expect(parseWebhook({ object: 'page' }, 'PNID').messages).toHaveLength(0)
  })

  it('parses delivery statuses with errors', () => {
    const { statuses } = parseWebhook(
      statusPayload('PNID', 'wamid.out', '9665', 'failed', {
        code: 131047,
        title: 'Re-engagement message',
        details: 'More than 24 hours have passed',
      }),
      'PNID',
    )
    expect(statuses[0]).toMatchObject({
      waMessageId: 'wamid.out',
      status: 'failed',
      error: { code: 131047, message: 'More than 24 hours have passed' },
    })
  })
})

describe('messagePreview', () => {
  it('uses body text or a type icon', () => {
    expect(messagePreview('TEXT', 'hello')).toBe('hello')
    expect(messagePreview('IMAGE', null)).toBe('📷')
  })
})

describe('webhook signature (NFR-07)', () => {
  const secret = 'a'.repeat(32)
  const body = Buffer.from(JSON.stringify(inboundPayload(env, textMessage('hi'))))

  it('accepts a valid signature', () => {
    expect(verifyWebhookSignature(body, signWebhookBody(body, secret), secret)).toBe(true)
  })

  it('rejects a wrong secret, a modified body or a missing header', () => {
    expect(verifyWebhookSignature(body, signWebhookBody(body, 'b'.repeat(32)), secret)).toBe(false)
    expect(
      verifyWebhookSignature(
        Buffer.concat([body, Buffer.from(' ')]),
        signWebhookBody(body, secret),
        secret,
      ),
    ).toBe(false)
    expect(verifyWebhookSignature(body, undefined, secret)).toBe(false)
    expect(verifyWebhookSignature(body, 'sha256=zz', secret)).toBe(false)
  })
})
