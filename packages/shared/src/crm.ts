import { z } from 'zod'

// ── Custom fields (FR-31) ──

export const CUSTOM_FIELD_TYPES = ['TEXT', 'NUMBER', 'DATE', 'SELECT'] as const
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number]

export const customFieldSchema = z
  .object({
    key: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{0,39}$/, 'Lowercase letters, numbers and _ only'),
    label: z.string().trim().min(1).max(60),
    type: z.enum(CUSTOM_FIELD_TYPES),
    options: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
  })
  .refine((f) => f.type !== 'SELECT' || f.options.length > 0, {
    message: 'Select fields need at least one option',
    path: ['options'],
  })
export type CustomFieldInput = z.infer<typeof customFieldSchema>

export interface CustomFieldDefinition {
  key: string
  label: string
  type: CustomFieldType
  options: string[]
}

/**
 * Validates contact custom field values against their definitions.
 * Unknown keys are dropped; empty values remove the field.
 */
export function cleanCustomFields(
  values: Record<string, unknown>,
  definitions: CustomFieldDefinition[],
): { values: Record<string, string | number>; errors: string[] } {
  const out: Record<string, string | number> = {}
  const errors: string[] = []
  for (const def of definitions) {
    const raw = values[def.key]
    if (raw === undefined || raw === null || raw === '') continue
    switch (def.type) {
      case 'NUMBER': {
        const n = typeof raw === 'number' ? raw : Number(String(raw).trim())
        if (Number.isFinite(n)) out[def.key] = n
        else errors.push(def.key)
        break
      }
      case 'DATE': {
        const s = String(raw).trim()
        if (/^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s))) out[def.key] = s
        else errors.push(def.key)
        break
      }
      case 'SELECT': {
        const s = String(raw).trim()
        if (def.options.includes(s)) out[def.key] = s
        else errors.push(def.key)
        break
      }
      default:
        out[def.key] = String(raw).trim().slice(0, 500)
    }
  }
  return { values: out, errors }
}

// ── Tags ──

export const tagSchema = z.object({
  name: z.string().trim().min(1).max(40),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .default('#64748b'),
})

// ── Contacts (FR-31, NFR-10) ──

export const contactUpdateSchema = z.object({
  name: z.string().trim().max(120).nullable().optional(),
  email: z
    .email()
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null)),
  company: z.string().trim().max(120).nullable().optional(),
  city: z.string().trim().max(80).nullable().optional(),
  language: z.enum(['ar', 'en']).nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  tagIds: z.array(z.string()).max(50).optional(),
  customFields: z.record(z.string(), z.unknown()).optional(),
  optInMarketing: z.boolean().optional(),
})
export type ContactUpdate = z.infer<typeof contactUpdateSchema>

export const contactListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  tagId: z.string().optional(),
  optIn: z.enum(['true', 'false']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

/** Starts a conversation with a number that has not written yet. */
export const contactCreateSchema = z.object({
  waId: z
    .string()
    .transform((s) => s.replace(/[^\d]/g, ''))
    .pipe(z.string().regex(/^\d{8,15}$/, 'International number with country code')),
  name: z.string().trim().max(120).optional(),
})

// ── Templates (FR-40, FR-41) ──

export const TEMPLATE_CATEGORIES = ['MARKETING', 'UTILITY', 'AUTHENTICATION'] as const

const templateButton = z.discriminatedUnion('type', [
  z.object({ type: z.literal('QUICK_REPLY'), text: z.string().trim().min(1).max(25) }),
  z.object({
    type: z.literal('URL'),
    text: z.string().trim().min(1).max(25),
    url: z.url().max(2000),
  }),
  z.object({
    type: z.literal('PHONE_NUMBER'),
    text: z.string().trim().min(1).max(25),
    phone_number: z.string().regex(/^\+?\d{8,15}$/),
  }),
])

/** A simple template: optional text or media header, body with {{1}} variables, footer, buttons. */
export const templateCreateSchema = z.object({
  name: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]{1,512}$/, 'Lowercase letters, numbers and _ only'),
  language: z.string().regex(/^[a-z]{2}(_[A-Z]{2})?$/, 'e.g. ar or en_US'),
  category: z.enum(TEMPLATE_CATEGORIES),
  /**
   * Text headers only: media headers need Meta's resumable upload API. Templates with
   * media headers can be created in WhatsApp Manager and are synced and sent normally.
   */
  header: z
    .object({
      text: z.string().trim().min(1).max(60),
      example: z.string().trim().min(1).max(60).optional(),
    })
    .optional(),
  body: z.string().trim().min(1).max(1024),
  /** One example value per {{n}} in the body, required by Meta's review. */
  bodyExamples: z.array(z.string().trim().min(1).max(200)).max(20).default([]),
  footer: z.string().trim().max(60).optional(),
  buttons: z.array(templateButton).max(10).default([]),
})
export type TemplateCreateInput = z.infer<typeof templateCreateSchema>

/** Number of {{n}} placeholders in a template text. */
export function templateVariableCount(text: string): number {
  const nums = [...text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1]))
  return nums.length ? Math.max(...nums) : 0
}

/**
 * FR-41: a template variable is either typed by the agent or taken from a contact
 * field such as `contact.name` or `custom.city`.
 */
export const templateSendSchema = z.object({
  templateId: z.string(),
  variables: z
    .array(
      z.union([
        z.object({ value: z.string().max(1024) }),
        z.object({ field: z.string().regex(/^(contact|custom)\.[a-zA-Z0-9_]+$/) }),
      ]),
    )
    .max(20)
    .default([]),
  headerMediaUrl: z.url().optional(),
})
export type TemplateSendInput = z.infer<typeof templateSendSchema>
