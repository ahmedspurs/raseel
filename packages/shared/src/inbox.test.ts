import { describe, expect, it } from 'vitest'
import {
  conversationListQuerySchema,
  conversationUpdateSchema,
  extractMentions,
  quickReplySchema,
} from './inbox.js'

describe('extractMentions', () => {
  it('finds unique user ids in mention tokens', () => {
    const body = 'Please call back <@cmabc1234567> and <@cmxyz7654321>, thanks <@cmabc1234567>'
    expect(extractMentions(body)).toEqual(['cmabc1234567', 'cmxyz7654321'])
  })

  it('ignores plain @ text', () => {
    expect(extractMentions('email me @ home or @sara')).toEqual([])
  })
})

describe('quickReplySchema', () => {
  it('accepts Arabic shortcuts and lowercases Latin ones', () => {
    expect(quickReplySchema.parse({ shortcut: 'مواعيد', title: 'Hours', body: '9-5' }).shortcut).toBe('مواعيد')
    expect(quickReplySchema.parse({ shortcut: 'Hours', title: 'Hours', body: '9-5' }).shortcut).toBe('hours')
  })

  it('rejects spaces and slashes', () => {
    expect(quickReplySchema.safeParse({ shortcut: 'a b', title: 't', body: 'b' }).success).toBe(false)
    expect(quickReplySchema.safeParse({ shortcut: '/hours', title: 't', body: 'b' }).success).toBe(false)
  })
})

describe('conversation schemas', () => {
  it('defaults the list view to all', () => {
    expect(conversationListQuerySchema.parse({}).view).toBe('all')
  })

  it('requires at least one field to update and allows clearing the assignee', () => {
    expect(conversationUpdateSchema.safeParse({}).success).toBe(false)
    expect(conversationUpdateSchema.parse({ assigneeId: null })).toEqual({ assigneeId: null })
  })
})
