import { z } from 'zod'

/** FR-14: inbox views. Every view except "closed" shows open and pending conversations. */
export const INBOX_VIEWS = ['mine', 'unassigned', 'team', 'all', 'closed'] as const
export type InboxView = (typeof INBOX_VIEWS)[number]

export const CONVERSATION_STATUSES = ['OPEN', 'PENDING', 'CLOSED'] as const
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number]

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .optional()

export const conversationListQuerySchema = z.object({
  view: z.enum(INBOX_VIEWS).default('all'),
  /** Narrows open views to one status. */
  status: z.enum(['OPEN', 'PENDING']).optional(),
  assigneeId: z.string().optional(),
  teamId: z.string().optional(),
  tagId: z.string().optional(),
  /** Last activity on or after / on or before these days (UTC). */
  from: isoDate,
  to: isoDate,
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
})
export type ConversationListQuery = z.infer<typeof conversationListQuerySchema>

/** FR-15, FR-16. `null` clears the assignee or team. */
export const conversationUpdateSchema = z
  .object({
    assigneeId: z.string().nullable().optional(),
    teamId: z.string().nullable().optional(),
    status: z.enum(CONVERSATION_STATUSES).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update')
export type ConversationUpdate = z.infer<typeof conversationUpdateSchema>

/**
 * FR-17: notes mention colleagues with `<@userId>` tokens. The web app shows them as
 * "@Name" and the server notifies each mentioned user.
 */
export const MENTION_PATTERN = /<@([a-z0-9]{10,40})>/gi

export function extractMentions(body: string): string[] {
  return [...new Set([...body.matchAll(MENTION_PATTERN)].map((m) => m[1]!))]
}

export const noteSchema = z.object({
  body: z.string().trim().min(1).max(4000),
})

/** FR-18: saved answers inserted with "/shortcut". */
export const quickReplySchema = z.object({
  shortcut: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[\p{L}\p{N}_-]{1,32}$/u, 'Letters, numbers, - and _ only'),
  title: z.string().trim().min(1).max(80),
  body: z.string().trim().min(1).max(4096),
  language: z.enum(['ar', 'en']).nullable().optional(),
})
export type QuickReplyInput = z.infer<typeof quickReplySchema>

/** FR-15: round-robin assignment of new conversations. */
export const inboxSettingsSchema = z.object({
  autoAssign: z.object({
    enabled: z.boolean(),
    /** Users who take part; empty means every active agent. */
    userIds: z.array(z.string()).max(200).default([]),
  }),
})
export type InboxSettings = z.infer<typeof inboxSettingsSchema>

export const DEFAULT_INBOX_SETTINGS: InboxSettings = {
  autoAssign: { enabled: false, userIds: [] },
}
