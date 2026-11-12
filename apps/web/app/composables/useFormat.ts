/** Locale-aware formatting helpers for the inbox. */
export function useFormat() {
  const { locale } = useI18n()

  const time = computed(() => new Intl.DateTimeFormat(locale.value, { timeStyle: 'short' }))
  const day = computed(
    () => new Intl.DateTimeFormat(locale.value, { day: 'numeric', month: 'short' }),
  )
  const full = computed(
    () => new Intl.DateTimeFormat(locale.value, { dateStyle: 'full', timeStyle: 'short' }),
  )

  /** "14:05" today, otherwise "12 Nov". */
  function shortDate(value: string | Date | null): string {
    if (!value) return ''
    const d = new Date(value)
    const today = new Date()
    return d.toDateString() === today.toDateString() ? time.value.format(d) : day.value.format(d)
  }

  /** "5h 12m" / "5 س 12 د" */
  function duration(ms: number): string {
    const totalMinutes = Math.max(0, Math.floor(ms / 60_000))
    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60
    const Duration = (
      Intl as unknown as {
        DurationFormat?: new (l: string, o: object) => { format(d: object): string }
      }
    ).DurationFormat
    if (Duration) {
      return new Duration(locale.value, { style: 'narrow' }).format(
        hours ? { hours, minutes } : { minutes },
      )
    }
    return hours ? `${hours}h ${minutes}m` : `${minutes}m`
  }

  return { shortDate, duration, time, full }
}

export function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '#'
  return parts
    .slice(0, 2)
    .map((p) => [...p][0])
    .join('')
    .toUpperCase()
}

/** Country codes common for Raseel's users, longest first so 249 wins over 2. */
const COUNTRY_CODES = ['966', '971', '965', '974', '973', '968', '962', '249', '20', '44', '1']

/**
 * Groups an international number for reading, e.g. +966 51 234 5678,
 * +971 50 111 2233, +1 415 555 0100. Unknown codes fall back to +digits.
 */
export function formatPhone(waId: string | null | undefined): string {
  const d = (waId ?? '').replace(/\D/g, '')
  if (!d) return ''
  const cc = COUNTRY_CODES.find((c) => d.startsWith(c) && d.length - c.length >= 7)
  if (!cc) return `+${d}`
  const rest = d.slice(cc.length)
  const groups =
    rest.length === 9
      ? [rest.slice(0, 2), rest.slice(2, 5), rest.slice(5)]
      : rest.length === 10
        ? [rest.slice(0, 3), rest.slice(3, 6), rest.slice(6)]
        : (rest.match(/.{1,3}/g) ?? [rest])
  return `+${cc} ${groups.join(' ')}`
}
