import { normalizeSearch, searchTerms } from '@raseel/shared'
import type { Contact, Prisma } from '../lib/db.js'

/** Text a contact is found by: names, number, email, company and city. */
export function contactSearchText(
  c: Pick<Contact, 'name' | 'waName' | 'waId' | 'email' | 'company' | 'city'>,
): string {
  return normalizeSearch(
    [c.name, c.waName, c.waId, c.email, c.company, c.city].filter(Boolean).join(' '),
  )
}

export function messageSearchText(body: string | null | undefined): string | null {
  return normalizeSearch(body) || null
}

/** Every term must appear somewhere in the indexed text (trigram index serves the LIKE). */
export function contactSearchWhere(query: string): Prisma.ContactWhereInput {
  const terms = searchTerms(query)
  return { AND: terms.map((t) => ({ searchText: { contains: t } })) }
}

export function messageSearchWhere(query: string): Prisma.MessageWhereInput {
  const terms = searchTerms(query)
  return { AND: terms.map((t) => ({ searchText: { contains: t } })) }
}
