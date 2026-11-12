import { describe, expect, it } from 'vitest'
import {
  automationRuleSchema,
  DEFAULT_AUTOMATION_SETTINGS,
  isOptOutMessage,
  isWithinWorkingHours,
  matchesKeywords,
} from './automation.js'
import { parseYes } from './sales.js'

describe('isOptOutMessage (FR-44)', () => {
  it('recognizes Arabic and English opt-out replies', () => {
    for (const t of ['STOP', 'stop', 'Stop.', 'إيقاف', 'ايقاف', 'إلغاء الاشتراك', 'Unsubscribe']) {
      expect(isOptOutMessage(t)).toBe(true)
    }
  })

  it('does not trigger on normal messages that mention the word', () => {
    expect(isOptOutMessage('please stop by tomorrow')).toBe(false)
    expect(isOptOutMessage('أبغى إيقاف الطلب رقم 5')).toBe(false)
    expect(isOptOutMessage(null)).toBe(false)
  })
})

describe('isWithinWorkingHours (FR-50)', () => {
  const hours = { ...DEFAULT_AUTOMATION_SETTINGS.workingHours, enabled: true }

  it('uses the business time zone', () => {
    // Sunday 2026-11-15 06:30 UTC = 09:30 in Riyadh (UTC+3).
    expect(isWithinWorkingHours(hours, 'Asia/Riyadh', new Date('2026-11-15T06:30:00Z'))).toBe(true)
    // 05:30 UTC = 08:30 Riyadh, before opening.
    expect(isWithinWorkingHours(hours, 'Asia/Riyadh', new Date('2026-11-15T05:30:00Z'))).toBe(false)
    // Closing time is exclusive: 17:00 Riyadh.
    expect(isWithinWorkingHours(hours, 'Asia/Riyadh', new Date('2026-11-15T14:00:00Z'))).toBe(false)
  })

  it('is closed on days off and always open when disabled', () => {
    // Friday 2026-11-13 10:00 Riyadh.
    const friday = new Date('2026-11-13T07:00:00Z')
    expect(isWithinWorkingHours(hours, 'Asia/Riyadh', friday)).toBe(false)
    expect(isWithinWorkingHours({ ...hours, enabled: false }, 'Asia/Riyadh', friday)).toBe(true)
  })
})

describe('matchesKeywords (FR-52)', () => {
  it('matches Arabic words with prefixes and spelling variants', () => {
    expect(matchesKeywords('كم السعر لو سمحت؟', ['سعر'], 'CONTAINS')).toBe(true)
    expect(matchesKeywords('ابي اعرف الأسعار', ['اسعار'], 'CONTAINS')).toBe(true)
    expect(matchesKeywords('Price list please', ['price'], 'CONTAINS')).toBe(true)
    expect(matchesKeywords('مرحبا', ['سعر', 'price'], 'CONTAINS')).toBe(false)
  })

  it('supports exact matches', () => {
    expect(matchesKeywords('موقعكم', ['موقعكم'], 'EXACT')).toBe(true)
    expect(matchesKeywords('وين موقعكم', ['موقعكم'], 'EXACT')).toBe(false)
  })
})

describe('schemas', () => {
  it('requires at least one rule action', () => {
    expect(
      automationRuleSchema.safeParse({ name: 'x', keywords: ['a'], actions: {} }).success,
    ).toBe(false)
  })

  it('parses yes values in Arabic and English', () => {
    expect(parseYes('نعم')).toBe(true)
    expect(parseYes('Yes')).toBe(true)
    expect(parseYes('no')).toBe(false)
  })
})

describe('update schemas keep unspecified fields untouched', () => {
  it('does not reset a deal value when only moving it', async () => {
    const { dealUpdateSchema, taskUpdateSchema } = await import('./sales.js')
    const { contactUpdateSchema } = await import('./crm.js')
    expect(dealUpdateSchema.parse({ stageId: 's1', position: 0 })).toEqual({
      stageId: 's1',
      position: 0,
    })
    expect(taskUpdateSchema.parse({ done: true })).toEqual({ done: true })
    expect(contactUpdateSchema.parse({ city: 'جدة' })).toEqual({ city: 'جدة' })
  })
})
