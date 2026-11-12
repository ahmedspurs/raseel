import { CSV_COLUMNS, parseYes } from '@raseel/shared'
import type { FastifyPluginAsync } from 'fastify'
import { parseCsv, toCsv } from '../lib/csv.js'
import type { Prisma } from '../lib/db.js'
import { currentUser, requirePermission } from '../plugins/auth.js'
import { contactSearchText } from '../services/search.js'

const MAX_ROWS = 20_000

/**
 * Normalizes phone numbers to WhatsApp ids (digits with country code).
 * Local Saudi mobile numbers (05XXXXXXXX) are converted to 9665XXXXXXXX.
 */
export function normalizePhone(raw: string, defaultCountry = '966'): string | null {
  const digits = raw.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/\D/g, '')
  if (!digits) return null
  let n = digits.startsWith('00') ? digits.slice(2) : digits
  if (/^0\d{9}$/.test(n)) n = defaultCountry + n.slice(1)
  return /^\d{8,15}$/.test(n) ? n : null
}

/** FR-32: contacts CSV import (with consent) and export. */
export const contactCsvRoutes: FastifyPluginAsync = async (app) => {
  const { db, audit } = app.ctx

  /** Full contact list as CSV. Bulk personal data, so Owner only (NFR-10). */
  app.get(
    '/contacts/export.csv',
    { preHandler: requirePermission('data:export') },
    async (req, reply) => {
      const [contacts, fields] = await Promise.all([
        db.contact.findMany({
          include: { tags: { include: { tag: true } } },
          orderBy: { createdAt: 'asc' },
        }),
        db.customField.findMany({ orderBy: { position: 'asc' } }),
      ])
      const rows: (string | number | null)[][] = [
        [
          'phone',
          'name',
          'whatsapp_name',
          'email',
          'company',
          'city',
          'language',
          'tags',
          'opt_in',
          'opted_in_at',
          ...fields.map((f) => f.key),
        ],
        ...contacts.map((c) => {
          const custom = c.customFields as Record<string, string | number>
          return [
            `+${c.waId}`,
            c.name,
            c.waName,
            c.email,
            c.company,
            c.city,
            c.language,
            c.tags.map((t) => t.tag.name).join('|'),
            c.optInMarketing ? 'yes' : 'no',
            c.optedInAt?.toISOString() ?? null,
            ...fields.map((f) => custom[f.key] ?? null),
          ]
        }),
      ]
      await audit.log({
        userId: currentUser(req).id,
        action: 'contacts.exported',
        meta: { count: contacts.length },
        ip: req.ip,
      })
      reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header(
          'Content-Disposition',
          `attachment; filename="raseel-contacts-${new Date().toISOString().slice(0, 10)}.csv"`,
        )
      return toCsv(rows)
    },
  )

  /**
   * Imports contacts from CSV. Existing numbers are updated, not duplicated.
   * Marketing consent is only recorded when the file says so explicitly.
   */
  app.post(
    '/contacts/import',
    { preHandler: requirePermission('settings:manage') },
    async (req, reply) => {
      const file = await req.file({ limits: { fileSize: 10 * 1024 * 1024 } })
      if (!file) return reply.code(400).send({ error: 'file_required' })
      const text = (await file.toBuffer()).toString('utf8')
      if (file.file.truncated) return reply.code(413).send({ error: 'file_too_large' })

      const rows = parseCsv(text)
      if (rows.length < 2) return reply.code(400).send({ error: 'empty_file' })
      if (rows.length - 1 > MAX_ROWS)
        return reply.code(413).send({ error: 'too_many_rows', max: MAX_ROWS })

      const fields = await db.customField.findMany()
      const header = rows[0]!.map((h) => h.trim().toLowerCase())
      const columns = header.map((h) => {
        if (CSV_COLUMNS[h]) return { kind: 'std' as const, key: CSV_COLUMNS[h] }
        const f = fields.find((x) => x.key === h || x.label.toLowerCase() === h)
        return f ? { kind: 'custom' as const, key: f.key } : null
      })
      if (!columns.some((c) => c?.key === 'waId')) {
        return reply.code(400).send({ error: 'phone_column_missing' })
      }

      const tagIds = new Map((await db.tag.findMany()).map((t) => [t.name.toLowerCase(), t.id]))
      const tagId = async (name: string) => {
        const key = name.trim().toLowerCase()
        if (!key) return null
        if (!tagIds.has(key))
          tagIds.set(key, (await db.tag.create({ data: { name: name.trim().slice(0, 40) } })).id)
        return tagIds.get(key)!
      }

      const result = {
        created: 0,
        updated: 0,
        optedIn: 0,
        errors: [] as { row: number; error: string }[],
      }
      for (const [index, row] of rows.slice(1).entries()) {
        const line = index + 2
        const rec: Record<string, string> = {}
        const custom: Record<string, string> = {}
        columns.forEach((c, i) => {
          const v = (row[i] ?? '').trim()
          if (!c || !v) return
          if (c.kind === 'std') rec[c.key] = v
          else custom[c.key] = v
        })
        const waId = normalizePhone(rec.waId ?? '')
        if (!waId) {
          result.errors.push({ row: line, error: 'invalid_phone' })
          continue
        }

        const existing = await db.contact.findUnique({ where: { waId } })
        const merged = {
          waId,
          name: rec.name ?? existing?.name ?? null,
          waName: existing?.waName ?? null,
          email: rec.email ?? existing?.email ?? null,
          company: rec.company ?? existing?.company ?? null,
          city: rec.city ?? existing?.city ?? null,
        }
        const optIn = rec.optIn !== undefined && parseYes(rec.optIn)
        const data = {
          ...merged,
          language:
            rec.language === 'ar' || rec.language === 'en'
              ? rec.language
              : (existing?.language ?? null),
          customFields: {
            ...((existing?.customFields as object) ?? {}),
            ...custom,
          } as Prisma.InputJsonValue,
          searchText: contactSearchText(merged),
          ...(optIn && !existing?.optInMarketing
            ? { optInMarketing: true, optedInAt: new Date() }
            : {}),
        }
        const contact = existing
          ? await db.contact.update({ where: { id: existing.id }, data })
          : await db.contact.create({ data })
        if (existing) result.updated++
        else result.created++
        if (optIn && !existing?.optInMarketing) result.optedIn++

        for (const name of (rec.tags ?? '').split(/[|،,]/)) {
          const id = await tagId(name)
          if (id) {
            await db.contactTag.upsert({
              where: { contactId_tagId: { contactId: contact.id, tagId: id } },
              create: { contactId: contact.id, tagId: id },
              update: {},
            })
          }
        }
      }

      // Consent imported from a file is recorded with its source (PDPL).
      await audit.log({
        userId: currentUser(req).id,
        action: 'contacts.imported',
        meta: { ...result, errors: result.errors.length, file: file.filename },
        ip: req.ip,
      })
      return { ...result, errors: result.errors.slice(0, 100) }
    },
  )
}
