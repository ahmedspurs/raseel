import { Redis } from 'ioredis'
import { type Config, loadConfig } from './config.js'
import type { AppContext } from './context.js'
import { Cipher, parseKey } from './lib/crypto.js'
import { createDb } from './lib/db.js'
import { createQueues } from './lib/queues.js'
import { AssignmentService } from './services/assignment.js'
import { AuditService } from './services/audit.js'
import { AuthService } from './services/auth.js'
import { EventBus } from './services/events.js'
import { InboundService } from './services/inbound.js'
import { Mailer } from './services/mailer.js'
import { MediaStorage } from './services/media.js'
import { OutboundService } from './services/outbound.js'
import { SettingsService } from './services/settings.js'
import { TemplateService } from './services/templates.js'
import { WhatsAppService } from './services/whatsapp.js'

/** Wires up shared services for the API server and the worker. */
export function createContext(config: Config = loadConfig()): AppContext {
  const db = createDb(config.DATABASE_URL)
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null })
  const cipher = new Cipher(parseKey(config.ENCRYPTION_KEY))
  const settings = new SettingsService(db, cipher)
  const queues = createQueues(redis)
  const events = new EventBus(redis)
  const media = new MediaStorage(config.MEDIA_DIR)
  const whatsapp = new WhatsAppService(settings, config)
  const audit = new AuditService(db)
  const assignment = new AssignmentService({ db, redis, settings, events, audit })
  const messaging = { db, queues, events, whatsapp, media, assignment }

  return {
    config,
    db,
    redis,
    cipher,
    settings,
    auth: new AuthService(db, cipher, config),
    audit,
    mailer: new Mailer(config),
    queues,
    events,
    media,
    whatsapp,
    inbound: new InboundService(messaging),
    outbound: new OutboundService(messaging),
    assignment,
    templates: new TemplateService(messaging),
  }
}

export async function closeContext(ctx: AppContext): Promise<void> {
  await Promise.allSettled([ctx.queues.close()])
  await Promise.allSettled([ctx.db.$disconnect(), ctx.redis.quit()])
}
