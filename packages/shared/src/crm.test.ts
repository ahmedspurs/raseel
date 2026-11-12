import { describe, expect, it } from 'vitest'
import {
  cleanCustomFields,
  contactCreateSchema,
  customFieldSchema,
  templateCreateSchema,
  templateVariableCount,
} from './crm.js'

describe('cleanCustomFields', () => {
  const defs = [
    { key: 'city', label: 'City', type: 'TEXT' as const, options: [] },
    { key: 'visits', label: 'Visits', type: 'NUMBER' as const, options: [] },
    { key: 'birthday', label: 'Birthday', type: 'DATE' as const, options: [] },
    { key: 'plan', label: 'Plan', type: 'SELECT' as const, options: ['Gold', 'Silver'] },
  ]

  it('keeps valid values, drops unknown keys and empty values', () => {
    expect(
      cleanCustomFields(
        { city: ' جدة ', visits: '3', birthday: '1990-04-02', plan: 'Gold', other: 'x', empty: '' },
        defs,
      ),
    ).toEqual({
      values: { city: 'جدة', visits: 3, birthday: '1990-04-02', plan: 'Gold' },
      errors: [],
    })
  })

  it('reports invalid values', () => {
    expect(
      cleanCustomFields({ visits: 'many', birthday: '02/04/1990', plan: 'Bronze' }, defs).errors,
    ).toEqual(['visits', 'birthday', 'plan'])
  })
})

describe('schemas', () => {
  it('requires options for select fields', () => {
    expect(
      customFieldSchema.safeParse({ key: 'plan', label: 'Plan', type: 'SELECT' }).success,
    ).toBe(false)
  })

  it('normalizes phone numbers for new contacts', () => {
    expect(contactCreateSchema.parse({ waId: '+966 50 123 4567' }).waId).toBe('966501234567')
    expect(contactCreateSchema.safeParse({ waId: '123' }).success).toBe(false)
  })

  it('validates template names and counts variables', () => {
    expect(
      templateCreateSchema.safeParse({
        name: 'Order Update',
        language: 'ar',
        category: 'UTILITY',
        body: 'x',
      }).success,
    ).toBe(false)
    expect(templateVariableCount('مرحبا {{1}}، طلبك {{2}} جاهز. {{1}}')).toBe(2)
    expect(templateVariableCount('no vars')).toBe(0)
  })
})
