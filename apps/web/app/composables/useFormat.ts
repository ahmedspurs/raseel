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
