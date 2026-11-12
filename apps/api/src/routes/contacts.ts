import {
  cleanCustomFields,
  contactCreateSchema,
  contactListQuerySchema,
  contactUpdateSchema,
  type CustomFieldDefinition,
  customFieldSchema,
  tagSchema,
} from '@raseel/shared'
import type { FastifyPluginAsync } from 'fastify'
import { z } from 'zod'
import { type Contact, type ContactTag, Prisma, type Tag } from '../lib/db.js'
import { currentUser, requirePermission } from '../plugins/auth.js'
import { contactSearchText, contactSearchWhere, messageSearchWhere } from '../services/search.js'
import { conversationDto } from './conversations.js'

type ContactRow = Contact & { tags: (ContactTag & { tag: Tag })[] }

export function contactDto(c: ContactRow) {
  return {
    id: c.id,
    waId: c.waId,
    name: c.name,
    waName: c.waName,
    displayName: c.name ?? c.waName ?? null,
    email: c.email,
    company: c.company,
    city: c.city,
    language: c.language,
    notes: c.notes,
    customFields: c.customFields as Record<string, string | number>,
    tags: c.tags.map((t) => ({ id: t.tag.id, name: t.tag.name, color: t.tag.color })),
    optInMarketing: c.optInMarketing,
    optedInAt: c.optedInAt,
    optedOutAt: c.optedOutAt,
    createdAt: c.createdAt,
  }
}

const withTags = { tags: { include: { tag: true } } } as const

const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'

const searchQuery = z.object({ q: z.string().trim().min(2).max(100) })

export const contactRoutes: FastifyPluginAsync = async (app) => {
  const { db, audit } = app.ctx
  const canView = requirePermission('contacts:view')
  const canEdit = requirePermission('contacts:edit')

  const customFieldDefs = async (): Promise<CustomFieldDefinition[]> =>
    (await db.customField.findMany({ orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] })).map(
      (f) => ({ key: f.key, label: f.label, type: f.type, options: f.options }),
    )

  // ── Contacts (FR-31) ──

  app.get('/contacts', { preHandler: canView }, async (req) => {
    const q = contactListQuerySchema.parse(req.query)
    const where: Prisma.ContactWhereInput = {
      ...(q.q ? contactSearchWhere(q.q) : {}),
      ...(q.tagId ? { tags: { some: { tagId: q.tagId } } } : {}),
      ...(q.optIn ? { optInMarketing: q.optIn === 'true' } : {}),
    }
    const [rows, total] = await Promise.all([
      db.contact.findMany({
        where,
        include: withTags,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: q.limit + 1,
        ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      }),
      db.contact.count({ where }),
    ])
    const page = rows.slice(0, q.limit)
    return {
      contacts: page.map(contactDto),
      total,
      nextCursor: rows.length > q.limit ? page.at(-1)?.id : null,
    }
  })

  /** Adds a number so an agent can start the conversation with a template. */
  app.post('/contacts', { preHandler: canEdit }, async (req, reply) => {
    const input = contactCreateSchema.parse(req.body)
    try {
      const contact = await db.contact.create({
        data: {
          waId: input.waId,
          name: input.name || null,
          searchText: contactSearchText({
            waId: input.waId,
            name: input.name ?? null,
            waName: null,
            email: null,
            company: null,
            city: null,
          }),
        },
        include: withTags,
      })
      return reply.code(201).send({ contact: contactDto(contact) })
    } catch (err) {
      if (isUniqueViolation(err)) {
        const existing = await db.contact.findUnique({ where: { waId: input.waId } })
        return reply.code(409).send({ error: 'contact_exists', contactId: existing?.id })
      }
      throw err
    }
  })

  app.get('/contacts/:id', { preHandler: canView }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const contact = await db.contact.findUnique({
      where: { id },
      include: {
        ...withTags,
        conversations: { orderBy: { createdAt: 'desc' }, include: { contact: true } },
      },
    })
    if (!contact) return reply.code(404).send({ error: 'not_found' })
    const messageCount = await db.message.count({ where: { conversation: { contactId: id } } })
    return {
      contact: contactDto(contact),
      conversations: contact.conversations.map(conversationDto),
      messageCount,
    }
  })

  app.patch('/contacts/:id', { preHandler: canEdit }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const input = contactUpdateSchema.parse(req.body)
    const existing = await db.contact.findUnique({ where: { id } })
    if (!existing) return reply.code(404).send({ error: 'not_found' })

    let customFields: Record<string, string | number> | undefined
    if (input.customFields) {
      const cleaned = cleanCustomFields(input.customFields, await customFieldDefs())
      if (cleaned.errors.length) {
        return reply.code(400).send({ error: 'invalid_custom_fields', fields: cleaned.errors })
      }
      customFields = cleaned.values
    }

    const merged = { ...existing, ...input }
    const data: Prisma.ContactUpdateInput = {
      name: input.name,
      email: input.email,
      company: input.company,
      city: input.city,
      language: input.language,
      notes: input.notes,
      customFields,
      searchText: contactSearchText(merged),
    }
    // Consent is recorded with a timestamp (PDPL, FR-42).
    if (input.optInMarketing !== undefined && input.optInMarketing !== existing.optInMarketing) {
      data.optInMarketing = input.optInMarketing
      if (input.optInMarketing) data.optedInAt = new Date()
      else data.optedOutAt = new Date()
    }

    const contact = await db.$transaction(async (tx) => {
      if (input.tagIds) {
        const tags = await tx.tag.findMany({
          where: { id: { in: input.tagIds } },
          select: { id: true },
        })
        await tx.contactTag.deleteMany({ where: { contactId: id } })
        await tx.contactTag.createMany({ data: tags.map((t) => ({ contactId: id, tagId: t.id })) })
      }
      return tx.contact.update({ where: { id }, data, include: withTags })
    })

    if (data.optInMarketing !== undefined) {
      await audit.log({
        userId: currentUser(req).id,
        action: input.optInMarketing ? 'contact.opted_in' : 'contact.opted_out',
        target: id,
        ip: req.ip,
      })
    }
    return { contact: contactDto(contact) }
  })

  /** NFR-10 (PDPL): everything Raseel stores about one contact, as JSON. */
  app.get(
    '/contacts/:id/export',
    { preHandler: requirePermission('data:export') },
    async (req, reply) => {
      const { id } = req.params as { id: string }
      const contact = await db.contact.findUnique({
        where: { id },
        include: {
          ...withTags,
          conversations: {
            include: {
              messages: { orderBy: { createdAt: 'asc' } },
              notes: { orderBy: { createdAt: 'asc' } },
            },
          },
        },
      })
      if (!contact) return reply.code(404).send({ error: 'not_found' })
      await audit.log({
        userId: currentUser(req).id,
        action: 'contact.exported',
        target: id,
        ip: req.ip,
      })
      reply.header(
        'Content-Disposition',
        `attachment; filename="raseel-contact-${contact.waId}.json"`,
      )
      return {
        exportedAt: new Date(),
        contact: contactDto(contact),
        conversations: contact.conversations.map((c) => ({
          id: c.id,
          status: c.status,
          createdAt: c.createdAt,
          messages: c.messages.map((m) => ({
            direction: m.direction,
            type: m.type,
            body: m.body,
            payload: m.payload,
            status: m.status,
            mediaFilename: m.mediaFilename,
            createdAt: m.createdAt,
          })),
          notes: c.notes.map((n) => ({ body: n.body, createdAt: n.createdAt })),
        })),
      }
    },
  )

  /** NFR-10 (PDPL): permanently deletes a contact, their conversations, messages and media. */
  app.delete(
    '/contacts/:id',
    { preHandler: requirePermission('data:export') },
    async (req, reply) => {
      const { id } = req.params as { id: string }
      const contact = await db.contact.findUnique({
        where: { id },
        include: { conversations: { include: { messages: { select: { mediaPath: true } } } } },
      })
      if (!contact) return reply.code(404).send({ error: 'not_found' })
      const files = contact.conversations.flatMap((c) =>
        c.messages.map((m) => m.mediaPath).filter((p): p is string => !!p),
      )
      await db.contact.delete({ where: { id } })
      await app.ctx.media.removeMany(files)
      await audit.log({
        userId: currentUser(req).id,
        action: 'contact.deleted',
        // The id only: the audit log must not keep the deleted person's phone number.
        target: contact.id,
        ip: req.ip,
      })
      return { ok: true }
    },
  )

  // ── Tags ──

  app.get('/tags', { preHandler: canView }, async () => {
    const tags = await db.tag.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { contacts: true } } },
    })
    return {
      tags: tags.map((t) => ({
        id: t.id,
        name: t.name,
        color: t.color,
        contactCount: t._count.contacts,
      })),
    }
  })

  app.post('/tags', { preHandler: requirePermission('tags:manage') }, async (req, reply) => {
    const input = tagSchema.parse(req.body)
    try {
      return reply.code(201).send({ tag: await db.tag.create({ data: input }) })
    } catch (err) {
      if (isUniqueViolation(err)) return reply.code(409).send({ error: 'name_taken' })
      throw err
    }
  })

  app.put('/tags/:id', { preHandler: requirePermission('tags:manage') }, async (req, reply) => {
    const { id } = req.params as { id: string }
    const input = tagSchema.parse(req.body)
    try {
      return { tag: await db.tag.update({ where: { id }, data: input }) }
    } catch (err) {
      if (isUniqueViolation(err)) return reply.code(409).send({ error: 'name_taken' })
      throw err
    }
  })

  app.delete('/tags/:id', { preHandler: requirePermission('tags:manage') }, async (req) => {
    const { id } = req.params as { id: string }
    await db.tag.deleteMany({ where: { id } })
    return { ok: true }
  })

  // ── Custom fields ──

  app.get('/custom-fields', { preHandler: canView }, async () => ({
    customFields: await db.customField.findMany({
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    }),
  }))

  app.post(
    '/custom-fields',
    { preHandler: requirePermission('settings:manage') },
    async (req, reply) => {
      const input = customFieldSchema.parse(req.body)
      try {
        const position = await db.customField.count()
        return reply
          .code(201)
          .send({ customField: await db.customField.create({ data: { ...input, position } }) })
      } catch (err) {
        if (isUniqueViolation(err)) return reply.code(409).send({ error: 'key_taken' })
        throw err
      }
    },
  )

  app.put(
    '/custom-fields/:id',
    { preHandler: requirePermission('settings:manage') },
    async (req, reply) => {
      const { id } = req.params as { id: string }
      // The key is the storage name and cannot change once values exist.
      const input = customFieldSchema.parse(req.body)
      const existing = await db.customField.findUnique({ where: { id } })
      if (!existing) return reply.code(404).send({ error: 'not_found' })
      if (existing.key !== input.key) return reply.code(400).send({ error: 'key_immutable' })
      return {
        customField: await db.customField.update({
          where: { id },
          data: { label: input.label, type: input.type, options: input.options },
        }),
      }
    },
  )

  app.delete(
    '/custom-fields/:id',
    { preHandler: requirePermission('settings:manage') },
    async (req) => {
      const { id } = req.params as { id: string }
      await db.customField.deleteMany({ where: { id } })
      return { ok: true }
    },
  )

  // ── FR-20: search across contacts and messages ──

  app.get('/search', { preHandler: requirePermission('conversations:view') }, async (req) => {
    const { q } = searchQuery.parse(req.query)
    const [contacts, messages] = await Promise.all([
      db.contact.findMany({ where: contactSearchWhere(q), include: withTags, take: 10 }),
      db.message.findMany({
        where: messageSearchWhere(q),
        include: { conversation: { include: { contact: true } } },
        orderBy: { createdAt: 'desc' },
        take: 30,
      }),
    ])
    return {
      contacts: contacts.map(contactDto),
      messages: messages.map((m) => ({
        id: m.id,
        conversationId: m.conversationId,
        direction: m.direction,
        body: m.body,
        createdAt: m.createdAt,
        contact: {
          id: m.conversation.contact.id,
          name: m.conversation.contact.name ?? m.conversation.contact.waName,
          waId: m.conversation.contact.waId,
        },
      })),
    }
  })
}
