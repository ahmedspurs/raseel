import { describe, expect, it } from 'vitest'
import { can, canAssignRole } from './roles.js'
import { setupSchema } from './schemas.js'

describe('can', () => {
  it('gives the owner every permission', () => {
    expect(can('OWNER', 'whatsapp:manage')).toBe(true)
    expect(can('OWNER', 'data:export')).toBe(true)
  })

  it('keeps WhatsApp connection and export owner-only', () => {
    expect(can('ADMIN', 'whatsapp:manage')).toBe(false)
    expect(can('ADMIN', 'data:export')).toBe(false)
  })

  it('lets admins manage users but not agents', () => {
    expect(can('ADMIN', 'users:manage')).toBe(true)
    expect(can('AGENT', 'users:manage')).toBe(false)
  })

  it('keeps viewers read-only', () => {
    expect(can('VIEWER', 'conversations:view')).toBe(true)
    expect(can('VIEWER', 'conversations:reply')).toBe(false)
    expect(can('VIEWER', 'notes:write')).toBe(false)
  })
})

describe('canAssignRole', () => {
  it('never allows creating a second owner', () => {
    expect(canAssignRole('OWNER', 'OWNER')).toBe(false)
  })

  it('lets admins assign only lower roles', () => {
    expect(canAssignRole('ADMIN', 'ADMIN')).toBe(false)
    expect(canAssignRole('ADMIN', 'AGENT')).toBe(true)
    expect(canAssignRole('OWNER', 'ADMIN')).toBe(true)
  })
})

describe('setupSchema', () => {
  const valid = {
    business: { name: 'Acme', language: 'ar', timeZone: 'Asia/Riyadh' },
    owner: { name: 'Sara', email: 'Sara@Example.com', password: 'a-long-password' },
  }

  it('normalizes email to lowercase', () => {
    expect(setupSchema.parse(valid).owner.email).toBe('sara@example.com')
  })

  it('rejects an unknown time zone', () => {
    const bad = { ...valid, business: { ...valid.business, timeZone: 'Mars/Base' } }
    expect(setupSchema.safeParse(bad).success).toBe(false)
  })

  it('rejects short passwords', () => {
    const bad = { ...valid, owner: { ...valid.owner, password: 'short' } }
    expect(setupSchema.safeParse(bad).success).toBe(false)
  })
})
