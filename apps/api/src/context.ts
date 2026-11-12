import type { Redis } from 'ioredis'
import type { Config } from './config.js'
import type { Cipher } from './lib/crypto.js'
import type { Db } from './lib/db.js'
import type { Queues } from './lib/queues.js'
import type { AssignmentService } from './services/assignment.js'
import type { AuditService } from './services/audit.js'
import type { AuthService } from './services/auth.js'
import type { AutomationService } from './services/automation.js'
import type { EventBus } from './services/events.js'
import type { InboundService } from './services/inbound.js'
import type { Mailer } from './services/mailer.js'
import type { MediaStorage } from './services/media.js'
import type { OutboundService } from './services/outbound.js'
import type { SettingsService } from './services/settings.js'
import type { TemplateService } from './services/templates.js'
import type { WhatsAppService } from './services/whatsapp.js'

/** Everything a route or job needs, created once at startup. */
export interface AppContext {
  config: Config
  db: Db
  redis: Redis
  cipher: Cipher
  settings: SettingsService
  auth: AuthService
  audit: AuditService
  mailer: Mailer
  queues: Queues
  events: EventBus
  media: MediaStorage
  whatsapp: WhatsAppService
  inbound: InboundService
  outbound: OutboundService
  assignment: AssignmentService
  templates: TemplateService
  automation: AutomationService
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext
  }
}
