import { z } from 'zod'

const booleanish = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1')

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  /** Public origin of the app, e.g. https://inbox.example.com */
  APP_URL: z.url().default('http://localhost:3000'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  /** Where downloaded WhatsApp media is stored. */
  MEDIA_DIR: z.string().default('./uploads'),
  /** Largest file agents may upload, in megabytes (WhatsApp documents allow up to 100 MB). */
  MEDIA_MAX_MB: z.coerce.number().int().positive().max(100).default(64),
  /** Used to convert browser voice recordings to OGG/Opus for WhatsApp. */
  FFMPEG_PATH: z.string().default('ffmpeg'),

  /** Meta Graph API. Pinned so Meta changes cannot break a running install (SRS §7.6). */
  /** Broadcast sending speed; keep within your number's messaging tier (FR-42). */
  BROADCAST_RATE_PER_SECOND: z.coerce.number().int().min(1).max(80).default(20),

  WHATSAPP_GRAPH_URL: z.url().default('https://graph.facebook.com'),
  WHATSAPP_API_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/)
    .default('v26.0'),

  /**
   * 32-byte key (base64 or hex) used to encrypt secrets at rest (NFR-08).
   * Generate with: openssl rand -base64 32
   */
  ENCRYPTION_KEY: z.string().min(32),

  /** Secret used to sign session cookies. */
  SESSION_SECRET: z.string().min(32),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),

  /** Set to false only for local HTTP development. */
  COOKIE_SECURE: booleanish.optional(),

  TRUST_PROXY: booleanish.default(true),

  /** Attempts per 15 minutes per IP on login, setup and invitation endpoints (NFR-09). */
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),

  /** Optional SMTP connection string for invitation emails, e.g. smtp://user:pass@host:587 */
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('Raseel <no-reply@localhost>'),
})

export type Config = z.infer<typeof envSchema> & { COOKIE_SECURE: boolean }

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    throw new Error(`Invalid environment configuration:\n${issues.join('\n')}`)
  }
  const cfg = parsed.data
  return {
    ...cfg,
    COOKIE_SECURE: cfg.COOKIE_SECURE ?? cfg.NODE_ENV === 'production',
  }
}
