/**
 * FR-20: Arabic-aware search normalization, applied both when storing searchable
 * text and when building queries, so spelling variants still match:
 *
 * - removes tashkeel (diacritics) and tatweel (ـ)
 * - unifies alef forms (أ إ آ ٱ → ا), taa marbuta (ة → ه), alef maqsura (ى → ي),
 *   and hamza carriers (ؤ → و, ئ → ي)
 * - converts Arabic-Indic and Persian digits to 0–9
 * - lowercases Latin text and collapses whitespace
 */
const DIACRITICS = /[ً-ٰٟۖ-ۭـ]/g
const CHAR_MAP: Record<string, string> = {
  أ: 'ا',
  إ: 'ا',
  آ: 'ا',
  ٱ: 'ا',
  ة: 'ه',
  ى: 'ي',
  ؤ: 'و',
  ئ: 'ي',
}
const DIGITS = /[٠-٩۰-۹]/g

export function normalizeSearch(text: string | null | undefined): string {
  if (!text) return ''
  return text
    .normalize('NFC')
    .replace(DIACRITICS, '')
    .replace(/[أإآٱةىؤئ]/g, (c) => CHAR_MAP[c] ?? c)
    .replace(DIGITS, (d) => String((d.charCodeAt(0) & 0xf) % 10))
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** Splits a query into normalized terms; every term must match. */
export function searchTerms(query: string): string[] {
  return [
    ...new Set(
      normalizeSearch(query)
        .split(' ')
        .filter((t) => t.length > 0),
    ),
  ].slice(0, 8)
}
