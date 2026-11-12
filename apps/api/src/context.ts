import type { Redis } from 'ioredis'
import type { Config } from './config.js'
import type { Cipher } from './lib/crypto.js'
import type { Db } from './lib/db.js'
import type { AuditService } from './services/audit.js'
import type { AuthService } from './services/auth.js'
import type { Mailer } from './services/mailer.js'
import type { SettingsService } from './services/settings.js'

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
}

declare module 'fastify' {
  interface FastifyInstance {
    ctx: AppContext
  }
}
