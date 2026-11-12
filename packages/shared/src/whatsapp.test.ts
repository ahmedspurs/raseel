import { describe, expect, it } from 'vitest'
import { customerWindow, mediaKindFor, whatsappSettingsSchema } from './whatsapp.js'

describe('customerWindow', () => {
  const now = new Date('2026-11-12T12:00:00Z')

  it('is closed when the customer never wrote', () => {
    expect(customerWindow(null, now)).toEqual({ open: false, closesAt: null, remainingMs: 0 })
  })

  it('is open for 24 hours after the last inbound message', () => {
    const w = customerWindow(new Date('2026-11-12T10:00:00Z'), now)
    expect(w.open).toBe(true)
    expect(w.remainingMs).toBe(22 * 3600 * 1000)
    expect(w.closesAt?.toISOString()).toBe('2026-11-13T10:00:00.000Z')
  })

  it('closes exactly at 24 hours', () => {
    expect(customerWindow('2026-11-11T12:00:00Z', now).open).toBe(false)
  })
})

describe('mediaKindFor', () => {
  it('sends supported types natively', () => {
    expect(mediaKindFor('image/jpeg')).toBe('image')
    expect(mediaKindFor('video/mp4')).toBe('video')
    expect(mediaKindFor('audio/ogg; codecs=opus')).toBe('audio')
  })

  it('falls back to document for everything else', () => {
    expect(mediaKindFor('application/pdf')).toBe('document')
    expect(mediaKindFor('image/gif')).toBe('document')
  })
})

describe('whatsappSettingsSchema', () => {
  it('requires numeric ids and a hex app secret', () => {
    expect(
      whatsappSettingsSchema.safeParse({
        phoneNumberId: '1234567890',
        wabaId: '9876543210',
        appSecret: 'a'.repeat(32),
      }).success,
    ).toBe(true)
    expect(whatsappSettingsSchema.safeParse({ phoneNumberId: 'abc', wabaId: '1' }).success).toBe(
      false,
    )
  })
})
