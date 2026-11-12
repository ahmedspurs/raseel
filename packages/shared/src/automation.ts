import { z } from 'zod'
import { normalizeSearch } from './search.js'

// ── FR-44: opt-out keywords ──

/** Replies that withdraw marketing consent (compared after normalization). */
export const OPT_OUT_KEYWORDS = [
  'stop',
  'unsubscribe',
  'ايقاف',
  'الغاء الاشتراك',
  'توقف',
  'stop all',
]

export function isOptOutMessage(text: string | null | undefined): boolean {
  const t = normalizeSearch(text)
    .replace(/[.!؟?]+$/u, '')
    .trim()
  return t.length > 0 && OPT_OUT_KEYWORDS.includes(t)
}

// ── FR-50: working hours ──

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM')

export const workingDaySchema = z
  .object({ open: z.boolean(), start: time, end: time })
  .refine((d) => !d.open || d.start < d.end, { message: 'Start must be before end', path: ['end'] })

/** Index 0 = Sunday … 6 = Saturday (JavaScript getDay order). */
export const automationSettingsSchema = z.object({
  workingHours: z.object({
    enabled: z.boolean(),
    days: z.array(workingDaySchema).length(7),
    awayMessage: z.string().trim().max(1024).default(''),
  }),
  welcome: z.object({
    enabled: z.boolean(),
    message: z.string().trim().max(1024).default(''),
    /** Up to three reply buttons shown under the welcome message. */
    buttons: z.array(z.string().trim().min(1).max(20)).max(3).default([]),
  }),
})
export type AutomationSettings = z.infer<typeof automationSettingsSchema>

const weekday = { open: true, start: '09:00', end: '17:00' }
export const DEFAULT_AUTOMATION_SETTINGS: AutomationSettings = {
  workingHours: {
    enabled: false,
    // Sunday–Thursday working week, common in Saudi Arabia.
    days: [
      weekday,
      weekday,
      weekday,
      weekday,
      weekday,
      { ...weekday, open: false },
      { ...weekday, open: false },
    ],
    awayMessage: '',
  },
  welcome: { enabled: false, message: '', buttons: [] },
}

/** Weekday (0–6) and minutes since midnight of `date` in a time zone. */
function localTime(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'))
  return { day, minutes: Number(get('hour')) * 60 + Number(get('minute')) }
}

const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

export function isWithinWorkingHours(
  hours: AutomationSettings['workingHours'],
  timeZone: string,
  date: Date = new Date(),
): boolean {
  if (!hours.enabled) return true
  const { day, minutes } = localTime(date, timeZone)
  const d = hours.days[day]
  return !!d && d.open && minutes >= toMinutes(d.start) && minutes < toMinutes(d.end)
}

// ── FR-52: keyword rules ──

export const automationRuleSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    keywords: z.array(z.string().trim().min(1).max(60)).min(1).max(20),
    match: z.enum(['CONTAINS', 'EXACT']).default('CONTAINS'),
    actions: z.object({
      tagId: z.string().nullable().optional(),
      assigneeId: z.string().nullable().optional(),
      teamId: z.string().nullable().optional(),
      reply: z.string().trim().max(1024).nullable().optional(),
    }),
    active: z.boolean().default(true),
  })
  .refine((r) => Object.values(r.actions).some((v) => v), {
    message: 'Choose at least one action',
    path: ['actions'],
  })
export type AutomationRuleInput = z.infer<typeof automationRuleSchema>

/** Arabic-aware keyword match: spelling variants and diacritics are ignored. */
export function matchesKeywords(
  text: string | null | undefined,
  keywords: string[],
  match: 'CONTAINS' | 'EXACT',
): boolean {
  const body = normalizeSearch(text)
  if (!body) return false
  return keywords.some((k) => {
    const kw = normalizeSearch(k)
    if (!kw) return false
    // Substring match also catches Arabic prefixes: "السعر" and "وسعر" contain "سعر".
    return match === 'EXACT' ? body === kw : body.includes(kw)
  })
}
