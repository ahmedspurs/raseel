import { describe, expect, it } from 'vitest'
import { parseCsv, toCsv } from './csv.js'

describe('parseCsv', () => {
  it('handles quotes, embedded commas, newlines, CRLF and BOM', () => {
    const csv =
      '\uFEFFphone,name,notes\r\n966500000001,"القحطاني, سارة","line1\nline2"\r\n966500000002,Ali,"He said ""hi"""\r\n'
    expect(parseCsv(csv)).toEqual([
      ['phone', 'name', 'notes'],
      ['966500000001', 'القحطاني, سارة', 'line1\nline2'],
      ['966500000002', 'Ali', 'He said "hi"'],
    ])
  })

  it('detects semicolon separators and skips blank lines', () => {
    expect(parseCsv('الجوال;الاسم\n\n0501;نورة\n')).toEqual([
      ['الجوال', 'الاسم'],
      ['0501', 'نورة'],
    ])
  })
})

describe('toCsv', () => {
  it('quotes when needed, adds a BOM and round-trips', () => {
    const out = toCsv([
      ['name', 'note'],
      ['سارة, أحمد', 'said "ok"'],
    ])
    expect(out.startsWith('\uFEFF')).toBe(true)
    expect(parseCsv(out)).toEqual([
      ['name', 'note'],
      ['سارة, أحمد', 'said "ok"'],
    ])
  })

  it('neutralizes spreadsheet formulas', () => {
    expect(toCsv([['=HYPERLINK("x")']])).toContain(`"'=HYPERLINK(""x"")"`)
    expect(toCsv([['+cmd|calc']])).toContain("'+cmd|calc")
    // Phone numbers and negative amounts stay as they are.
    expect(toCsv([['+966500000001', '-250.5']])).toBe('\uFEFF+966500000001,-250.5\r\n')
  })
})
