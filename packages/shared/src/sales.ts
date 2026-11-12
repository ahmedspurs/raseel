import { z } from 'zod'

// ── FR-33: deals pipeline ──

export const stageSchema = z.object({
  name: z.string().trim().min(1).max(40),
  kind: z.enum(['OPEN', 'WON', 'LOST']).default('OPEN'),
})

export const pipelineSchema = z.object({
  name: z.string().trim().min(1).max(60),
  stages: z
    .array(stageSchema.extend({ id: z.string().optional() }))
    .min(1)
    .max(20),
})

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

export const dealSchema = z.object({
  title: z.string().trim().min(1).max(120),
  contactId: z.string(),
  stageId: z.string(),
  valueSar: z.coerce.number().min(0).max(1_000_000_000).default(0),
  ownerId: z.string().nullable().optional(),
  expectedClose: isoDay.nullable().optional(),
})
export const dealUpdateSchema = dealSchema
  .partial()
  .omit({ contactId: true })
  .extend({
    /** Drop position within the target stage (Kanban drag). */
    position: z.number().int().min(0).optional(),
  })

// ── FR-34: tasks ──

export const taskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
  contactId: z.string().nullable().optional(),
  dealId: z.string().nullable().optional(),
  assigneeId: z.string().nullable().optional(),
})
export const taskUpdateSchema = taskSchema.partial().extend({ done: z.boolean().optional() })

// ── FR-35: segments ──

export const segmentFilterSchema = z.object({
  /** Contacts must have any (or all) of these tags; empty = every contact. */
  tagIds: z.array(z.string()).max(20).default([]),
  tagMatch: z.enum(['any', 'all']).default('any'),
  /** Custom field equals value, e.g. { city: 'Riyadh' }. */
  fields: z.record(z.string(), z.string().max(200)).default({}),
  language: z.enum(['ar', 'en']).nullable().default(null),
})
export type SegmentFilter = z.infer<typeof segmentFilterSchema>

export const segmentSchema = z.object({
  name: z.string().trim().min(1).max(80),
  filter: segmentFilterSchema,
})

// ── FR-42: broadcasts ──

export const broadcastSchema = z.object({
  name: z.string().trim().min(1).max(120),
  templateId: z.string(),
  segmentId: z.string().nullable(),
  variables: z
    .array(
      z.union([
        z.object({ value: z.string().max(1024) }),
        z.object({ field: z.string().regex(/^(contact|custom)\.[a-zA-Z0-9_]+$/) }),
      ]),
    )
    .max(20)
    .default([]),
  headerMediaUrl: z.url().nullable().optional(),
  /** null sends now. */
  scheduledAt: z.iso.datetime({ offset: true }).nullable().optional(),
})
export type BroadcastInput = z.infer<typeof broadcastSchema>

// ── FR-32: CSV import ──

/** Recognized CSV headers (case-insensitive, Arabic or English). */
export const CSV_COLUMNS: Record<
  string,
  'waId' | 'name' | 'email' | 'company' | 'city' | 'tags' | 'optIn' | 'language'
> = {
  phone: 'waId',
  mobile: 'waId',
  whatsapp: 'waId',
  wa_id: 'waId',
  'رقم الجوال': 'waId',
  الجوال: 'waId',
  الهاتف: 'waId',
  name: 'name',
  الاسم: 'name',
  email: 'email',
  'البريد الإلكتروني': 'email',
  company: 'company',
  الشركة: 'company',
  city: 'city',
  المدينة: 'city',
  tags: 'tags',
  الوسوم: 'tags',
  opt_in: 'optIn',
  optin: 'optIn',
  marketing: 'optIn',
  الموافقة: 'optIn',
  language: 'language',
  اللغة: 'language',
}

const YES = new Set(['yes', 'y', 'true', '1', 'نعم', 'موافق'])
export const parseYes = (v: string | undefined) => YES.has((v ?? '').trim().toLowerCase())
