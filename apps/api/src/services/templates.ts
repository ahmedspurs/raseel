import {
  type TemplateCreateInput,
  type TemplateSendInput,
  templateVariableCount,
} from '@raseel/shared'
import type { Contact, Db, Message, Prisma, Template } from '../lib/db.js'
import { jobId, type Queues } from '../lib/queues.js'
import { WhatsAppApiError } from '../whatsapp/errors.js'
import type { EventBus } from './events.js'
import { messageSearchText } from './search.js'
import type { WhatsAppService } from './whatsapp.js'

export class TemplateError extends Error {
  constructor(
    readonly code:
      | 'not_connected'
      | 'not_found'
      | 'not_approved'
      | 'missing_variables'
      | 'header_media_required'
      | 'meta_error',
    readonly status: number,
    readonly detail?: unknown,
  ) {
    super(code)
  }
}

interface Component {
  type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS'
  format?: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'LOCATION'
  text?: string
  buttons?: unknown[]
}

/** What Raseel stores in Message.payload for a sent template, used to build the API call. */
export interface TemplatePayload {
  template: {
    name: string
    language: { code: string }
    components: Record<string, unknown>[]
  }
}

const fillText = (text: string, values: string[]) =>
  text.replace(/\{\{\s*(\d+)\s*\}\}/g, (m, n: string) => values[Number(n) - 1] ?? m)

interface Deps {
  db: Db
  queues: Queues
  events: EventBus
  whatsapp: WhatsAppService
}

/** FR-40 and FR-41: approved templates synced from Meta, created here, and sent to contacts. */
export class TemplateService {
  constructor(private readonly deps: Deps) {}

  private async connection() {
    const creds = await this.deps.whatsapp.credentials()
    if (!creds) throw new TemplateError('not_connected', 409)
    return { creds, client: this.deps.whatsapp.clientFor(creds) }
  }

  /** Mirrors the WABA's templates: adds new ones, updates statuses, removes deleted ones. */
  async sync(): Promise<{ total: number; approved: number }> {
    const { db } = this.deps
    const { creds, client } = await this.connection()
    let remote
    try {
      remote = await client.listTemplates(creds.wabaId)
    } catch (err) {
      throw new TemplateError(
        'meta_error',
        502,
        err instanceof WhatsAppApiError ? err.toJSON() : null,
      )
    }
    const now = new Date()
    for (const t of remote) {
      const data = {
        name: t.name,
        language: t.language,
        category: t.category,
        components: t.components as Prisma.InputJsonValue,
        status: t.status,
        rejectedReason:
          t.rejected_reason && t.rejected_reason !== 'NONE' ? t.rejected_reason : null,
        syncedAt: now,
      }
      await db.template.upsert({
        where: { name_language: { name: t.name, language: t.language } },
        create: { metaTemplateId: t.id, ...data },
        update: { metaTemplateId: t.id, ...data },
      })
    }
    await db.template.deleteMany({
      where: { metaTemplateId: { notIn: remote.map((t) => t.id) } },
    })
    return { total: remote.length, approved: remote.filter((t) => t.status === 'APPROVED').length }
  }

  /** Builds Meta's component format from the simple form and submits it for review. */
  async create(input: TemplateCreateInput): Promise<Template> {
    const { creds, client } = await this.connection()
    const components: Record<string, unknown>[] = []
    if (input.header) {
      components.push({
        type: 'HEADER',
        format: 'TEXT',
        text: input.header.text,
        ...(templateVariableCount(input.header.text) && input.header.example
          ? { example: { header_text: [input.header.example] } }
          : {}),
      })
    }
    const vars = templateVariableCount(input.body)
    if (vars > input.bodyExamples.length) throw new TemplateError('missing_variables', 400)
    components.push({
      type: 'BODY',
      text: input.body,
      ...(vars ? { example: { body_text: [input.bodyExamples.slice(0, vars)] } } : {}),
    })
    if (input.footer) components.push({ type: 'FOOTER', text: input.footer })
    if (input.buttons.length) components.push({ type: 'BUTTONS', buttons: input.buttons })

    let created
    try {
      created = await client.createTemplate(creds.wabaId, {
        name: input.name,
        language: input.language,
        category: input.category,
        components,
      })
    } catch (err) {
      throw new TemplateError(
        'meta_error',
        422,
        err instanceof WhatsAppApiError ? err.toJSON() : null,
      )
    }
    return this.deps.db.template.upsert({
      where: { name_language: { name: input.name, language: input.language } },
      create: {
        metaTemplateId: created.id,
        name: input.name,
        language: input.language,
        category: input.category,
        components: components as Prisma.InputJsonValue,
        status: created.status,
      },
      update: {
        metaTemplateId: created.id,
        components: components as Prisma.InputJsonValue,
        status: created.status,
      },
    })
  }

  async remove(id: string): Promise<void> {
    const template = await this.deps.db.template.findUnique({ where: { id } })
    if (!template) throw new TemplateError('not_found', 404)
    const { creds, client } = await this.connection()
    try {
      await client.deleteTemplate(creds.wabaId, template.name)
    } catch (err) {
      throw new TemplateError(
        'meta_error',
        422,
        err instanceof WhatsAppApiError ? err.toJSON() : null,
      )
    }
    await this.deps.db.template.deleteMany({ where: { name: template.name } })
  }

  /** Resolves each variable from typed text or a contact field. */
  private resolveVariables(input: TemplateSendInput['variables'], contact: Contact): string[] {
    const custom = (contact.customFields ?? {}) as Record<string, unknown>
    const fields: Record<string, string | null> = {
      'contact.name': contact.name ?? contact.waName,
      'contact.firstName': (contact.name ?? contact.waName ?? '').split(/\s+/)[0] || null,
      'contact.phone': `+${contact.waId}`,
      'contact.email': contact.email,
      'contact.company': contact.company,
      'contact.city': contact.city,
    }
    return input.map((v) => {
      if ('value' in v) return v.value
      if (v.field.startsWith('custom.')) {
        const value = custom[v.field.slice('custom.'.length)]
        return value === undefined || value === null ? '' : String(value)
      }
      return fields[v.field] ?? ''
    })
  }

  /**
   * FR-41: sends an approved template to a contact. Works outside the 24-hour window,
   * so it also starts conversations with customers who have not written yet.
   */
  async send(contactId: string, userId: string, input: TemplateSendInput): Promise<Message> {
    const { db, queues, events } = this.deps
    await this.connection()
    const [template, contact] = await Promise.all([
      db.template.findUnique({ where: { id: input.templateId } }),
      db.contact.findUnique({ where: { id: contactId } }),
    ])
    if (!template || !contact) throw new TemplateError('not_found', 404)
    if (template.status !== 'APPROVED') throw new TemplateError('not_approved', 422)

    const components = template.components as unknown as Component[]
    const header = components.find((c) => c.type === 'HEADER')
    const body = components.find((c) => c.type === 'BODY')
    const headerVars = header?.format === 'TEXT' ? templateVariableCount(header.text ?? '') : 0
    const bodyVars = templateVariableCount(body?.text ?? '')

    const values = this.resolveVariables(input.variables, contact)
    if (values.length < headerVars + bodyVars || values.some((v) => !v.trim())) {
      throw new TemplateError('missing_variables', 400, { expected: headerVars + bodyVars })
    }
    const headerValues = values.slice(0, headerVars)
    const bodyValues = values.slice(headerVars, headerVars + bodyVars)

    const apiComponents: Record<string, unknown>[] = []
    if (header && header.format && header.format !== 'TEXT' && header.format !== 'LOCATION') {
      if (!input.headerMediaUrl) throw new TemplateError('header_media_required', 400)
      const kind = header.format.toLowerCase()
      apiComponents.push({
        type: 'header',
        parameters: [{ type: kind, [kind]: { link: input.headerMediaUrl } }],
      })
    } else if (headerValues.length) {
      apiComponents.push({
        type: 'header',
        parameters: headerValues.map((text) => ({ type: 'text', text })),
      })
    }
    if (bodyValues.length) {
      apiComponents.push({
        type: 'body',
        parameters: bodyValues.map((text) => ({ type: 'text', text })),
      })
    }

    const rendered = [
      header?.format === 'TEXT' && header.text ? fillText(header.text, headerValues) : null,
      body?.text ? fillText(body.text, bodyValues) : null,
      components.find((c) => c.type === 'FOOTER')?.text ?? null,
    ]
      .filter(Boolean)
      .join('\n\n')

    const payload: TemplatePayload = {
      template: {
        name: template.name,
        language: { code: template.language },
        components: apiComponents,
      },
    }

    const conversation =
      (await db.conversation.findFirst({ where: { contactId }, orderBy: { createdAt: 'desc' } })) ??
      (await db.conversation.create({ data: { contactId } }))

    const message = await db.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'OUTBOUND',
        type: 'TEMPLATE',
        body: rendered,
        searchText: messageSearchText(rendered),
        payload: payload as unknown as Prisma.InputJsonValue,
        status: 'QUEUED',
        sentByUserId: userId,
      },
    })
    await db.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: message.createdAt,
        lastMessagePreview: `📝 ${rendered.slice(0, 120)}`,
        ...(conversation.status === 'CLOSED' ? { status: 'OPEN', closedAt: null } : {}),
      },
    })
    await queues.send.add('send', { messageId: message.id }, { jobId: jobId('send', message.id) })
    await events.publish({
      type: 'message.created',
      conversationId: conversation.id,
      messageId: message.id,
    })
    await events.publish({ type: 'conversation.updated', conversationId: conversation.id })
    return message
  }
}
