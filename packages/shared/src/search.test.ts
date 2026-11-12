import { describe, expect, it } from 'vitest'
import { normalizeSearch, searchTerms } from './search.js'

describe('normalizeSearch', () => {
  it('unifies alef forms, taa marbuta and alef maqsura', () => {
    expect(normalizeSearch('أحمد')).toBe(normalizeSearch('احمد'))
    expect(normalizeSearch('إيمان')).toBe('ايمان')
    expect(normalizeSearch('مدرسة')).toBe(normalizeSearch('مدرسه'))
    expect(normalizeSearch('مستشفى')).toBe(normalizeSearch('مستشفي'))
  })

  it('removes diacritics and tatweel', () => {
    expect(normalizeSearch('مُحَمَّد')).toBe('محمد')
    expect(normalizeSearch('سـلام')).toBe('سلام')
  })

  it('converts Arabic-Indic digits and lowercases Latin', () => {
    expect(normalizeSearch('٠٥٥١٢٣')).toBe('055123')
    expect(normalizeSearch('۰۹')).toBe('09')
    expect(normalizeSearch('  Hello   WORLD ')).toBe('hello world')
  })

  it('handles empty input', () => {
    expect(normalizeSearch(null)).toBe('')
  })
})

describe('searchTerms', () => {
  it('returns unique normalized terms', () => {
    expect(searchTerms('موعد  أسنان موعد')).toEqual(['موعد', 'اسنان'])
  })
})
