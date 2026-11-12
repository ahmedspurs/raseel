/**
 * Minimal RFC 4180 CSV support for contact import and export (FR-32): quoted
 * fields, escaped quotes, commas and line breaks inside quotes, CRLF or LF, and
 * an optional UTF-8 BOM. Semicolon-separated files (common in Arabic Excel
 * locales) are detected from the header line.
 */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  const firstLine = text.slice(0, text.search(/\r?\n|$/))
  const delimiter = firstLine.split(';').length > firstLine.split(',').length ? ';' : ','

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]!
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
        }
      } else {
        field += c
      }
      continue
    }
    if (c === '"' && field === '') quoted = true
    else if (c === delimiter) {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ''))
}

/** Byte order mark: tells Excel the file is UTF-8 (needed for Arabic). */
const BOM = String.fromCharCode(0xfeff)
const needsQuotes = /[",\r\n]/

/** Builds CSV with a BOM so Excel opens Arabic text correctly. */
export function toCsv(rows: (string | number | boolean | null | undefined)[][]): string {
  const body = rows
    .map((r) =>
      r
        .map((v) => {
          const s = v === null || v === undefined ? '' : String(v)
          // Prevent spreadsheet formula injection from customer-controlled values.
          // A leading + or - is only dangerous when followed by more than a number.
          const safe = /^(?:[=@\t\r]|[+-](?![\d\s.]*$))/.test(s) ? `'${s}` : s
          return needsQuotes.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
        })
        .join(','),
    )
    .join('\r\n')
  return `${BOM}${body}\r\n`
}
