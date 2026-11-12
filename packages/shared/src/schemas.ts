import { z } from 'zod'
import { ROLES } from './roles.js'

export const LANGUAGES = ['ar', 'en'] as const
export type Language = (typeof LANGUAGES)[number]

export const languageSchema = z.enum(LANGUAGES)
export const roleSchema = z.enum(ROLES)

export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters')

const timeZoneSchema = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
    return true
  } catch {
    return false
  }
}, 'Invalid time zone')

/** FR-01: first-run setup wizard. */
export const setupSchema = z.object({
  business: z.object({
    name: z.string().trim().min(1).max(120),
    language: languageSchema.default('ar'),
    timeZone: timeZoneSchema.default('Asia/Riyadh'),
  }),
  owner: z.object({
    name: z.string().trim().min(1).max(120),
    email: z.email().transform((e) => e.toLowerCase()),
    password: passwordSchema,
  }),
})
export type SetupInput = z.infer<typeof setupSchema>

export const loginSchema = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  password: z.string().min(1).max(128),
  totp: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
})
export type LoginInput = z.infer<typeof loginSchema>

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  language: languageSchema.optional(),
})

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
})

export const inviteUserSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.email().transform((e) => e.toLowerCase()),
  role: roleSchema.exclude(['OWNER']),
  teamIds: z.array(z.string()).default([]),
})
export type InviteUserInput = z.infer<typeof inviteUserSchema>

export const acceptInviteSchema = z.object({
  token: z.string().min(20).max(200),
  password: passwordSchema,
})

export const updateUserSchema = z.object({
  role: roleSchema.exclude(['OWNER']).optional(),
  active: z.boolean().optional(),
  teamIds: z.array(z.string()).optional(),
})

export const teamSchema = z.object({
  name: z.string().trim().min(1).max(80),
  memberIds: z.array(z.string()).default([]),
})

export const businessSettingsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  language: languageSchema,
  timeZone: timeZoneSchema,
  logoUrl: z.url().nullable().optional(),
})
export type BusinessSettings = z.infer<typeof businessSettingsSchema>
