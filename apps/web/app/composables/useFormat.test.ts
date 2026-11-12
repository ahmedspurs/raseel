import { describe, expect, it } from 'vitest'
import { formatPhone } from './useFormat'

describe('formatPhone', () => {
  it('groups common Gulf and international numbers', () => {
    expect(formatPhone('966512345678')).toBe('+966 51 234 5678')
    expect(formatPhone('971501112233')).toBe('+971 50 111 2233')
    expect(formatPhone('201001234567')).toBe('+20 100 123 4567')
    expect(formatPhone('14155550100')).toBe('+1 415 555 0100')
    expect(formatPhone('249912345678')).toBe('+249 91 234 5678')
  })

  it('falls back to plain digits', () => {
    expect(formatPhone('8613800138000')).toBe('+8613800138000')
    expect(formatPhone(null)).toBe('')
  })
})
