import {
  type AutomationSettings,
  type BusinessSettings,
  DEFAULT_AUTOMATION_SETTINGS,
  isOptOutMessage,
  isWithinWorkingHours,
  matchesKeywords,
} from '@raseel/shared'
import type { Redis } from 'ioredis'
import type { Db } from '../lib/db.js'
import type { AuditService } from './audit.js'
import type { EventBus } from './events.js'
import type { OutboundService } from './outbound.js'
import { SettingKey, type SettingsService } from './settings.js'

/** One away message per conversation within this period, so customers are not spammed. */
const AWAY_COOLDOWN_SECONDS = 12 * 60 * 60

interface RuleActions {
  tagId?: string | null
  assigneeId?: string | null
  teamId?: string | null
  reply?: string | null
}

export interface InboundContext {
  conversationId: string
  contactId: string
  messageId: string
  body: string | null
  /** True when this is the contact's first message ever. */
  firstMessage: boolean
}

interface Deps {
  db: Db
  redis: Redis
  settings: SettingsService
  events: EventBus
  audit: AuditService
  outbound: OutboundService
}

/**
 * Runs after each customer message: opt-out (FR-44), welcome (FR-51),
 * away message outside working hours (FR-50) and keyword rules (FR-52).
 */
export class AutomationService {
  constructor(private readonly deps: Deps) {}

  async getSettings(): Promise<AutomationSettings> {
    const saved = await this.deps.settings.getJson<AutomationSettings>(
      SettingKey.AutomationSettings,
    )
    return saved ?? DEFAULT_AUTOMATION_SETTINGS
  }

  async saveSettings(input: AutomationSettings): Promise<void> {
    await this.deps.settings.setJson(SettingKey.AutomationSettings, input)
  }

  async onInbound(ctx: InboundContext): Promise<string[]> {
    const done: string[] = []

    // FR-44: a STOP / إيقاف reply withdraws marketing consent immediately.
    if (isOptOutMessage(ctx.body)) {
      const res = await this.deps.db.contact.updateMany({
        where: { id: ctx.contactId, optInMarketing: true },
        data: { optInMarketing: false, optedOutAt: new Date() },
      })
      await this.deps.audit.log({
        action: 'contact.opted_out',
        target: ctx.contactId,
        meta: { via: 'keyword', changed: res.count > 0 },
      })
      done.push('opt_out')
      // An opt-out is not a conversation starter: skip welcome and rules.
      return done
    }

    const settings = await this.getSettings()

    if (ctx.firstMessage && settings.welcome.enabled && settings.welcome.message) {
      await this.deps.outbound.createAutomated(ctx.conversationId, {
        body: settings.welcome.message,
        buttons: settings.welcome.buttons,
      })
      done.push('welcome')
    }

    if (settings.workingHours.enabled && settings.workingHours.awayMessage) {
      const business = await this.deps.settings.getJson<BusinessSettings>(SettingKey.Business)
      const open = isWithinWorkingHours(settings.workingHours, business?.timeZone ?? 'Asia/Riyadh')
      if (!open) {
        const first = await this.deps.redis.set(
          `raseel:away:${ctx.conversationId}`,
          '1',
          'EX',
          AWAY_COOLDOWN_SECONDS,
          'NX',
        )
        if (first === 'OK') {
          await this.deps.outbound.createAutomated(ctx.conversationId, {
            body: settings.workingHours.awayMessage,
          })
          done.push('away')
        }
      }
    }

    const rule = await this.matchRule(ctx.body)
    if (rule) {
      await this.applyRule(rule.id, rule.actions as RuleActions, ctx)
      done.push(`rule:${rule.id}`)
    }
    return done
  }

  /** The first active rule (by position) whose keywords match. */
  private async matchRule(body: string | null) {
    if (!body) return null
    const rules = await this.deps.db.automationRule.findMany({
      where: { active: true },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    })
    return rules.find((r) => matchesKeywords(body, r.keywords, r.match)) ?? null
  }

  private async applyRule(ruleId: string, actions: RuleActions, ctx: InboundContext) {
    const { db, events, audit, outbound } = this.deps
    if (actions.tagId && (await db.tag.findUnique({ where: { id: actions.tagId } }))) {
      await db.contactTag.upsert({
        where: { contactId_tagId: { contactId: ctx.contactId, tagId: actions.tagId } },
        create: { contactId: ctx.contactId, tagId: actions.tagId },
        update: {},
      })
    }
    const assignment: { assigneeId?: string; teamId?: string } = {}
    if (actions.assigneeId) {
      const user = await db.user.findUnique({ where: { id: actions.assigneeId } })
      if (user?.active && user.role !== 'VIEWER') assignment.assigneeId = user.id
    }
    if (actions.teamId && (await db.team.findUnique({ where: { id: actions.teamId } }))) {
      assignment.teamId = actions.teamId
    }
    if (Object.keys(assignment).length) {
      await db.conversation.update({ where: { id: ctx.conversationId }, data: assignment })
      await audit.log({
        action: 'conversation.assigned',
        target: ctx.conversationId,
        meta: { ...assignment, ruleId },
      })
    }
    if (actions.reply) {
      await outbound.createAutomated(ctx.conversationId, { body: actions.reply })
    }
    await events.publish({ type: 'conversation.updated', conversationId: ctx.conversationId })
  }
}
