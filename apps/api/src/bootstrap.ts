import { Redis } from 'ioredis'
import { type Config, loadConfig } from './config.js'
import type { AppContext } from './context.js'
import { Cipher, parseKey } from './lib/crypto.js'
import { createDb } from './lib/db.js'
import { AuditService } from './services/audit.js'
import { AuthService } from './services/auth.js'
import { Mailer } from './services/mailer.js'
import { SettingsService } from './services/settings.js'

/** Wires up shared services for the API server and the worker. */
export function createContext(config: Config = loadConfig()): AppContext {
  const db = createDb(config.DATABASE_URL)
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null })
  const cipher = new Cipher(parseKey(config.ENCRYPTION_KEY))
  return {
    config,
    db,
    redis,
    cipher,
    settings: new SettingsService(db, cipher),
    auth: new AuthService(db, cipher, config),
    audit: new AuditService(db),
    mailer: new Mailer(config),
  }
}

export async function closeContext(ctx: AppContext): Promise<void> {
  await Promise.allSettled([ctx.db.$disconnect(), ctx.redis.quit()])
}
