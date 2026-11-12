import { randomBytes } from 'node:crypto'

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://raseel:raseel@localhost:55432/raseel_test'
export const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:56379/15'

export const testEnv = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'fatal',
  APP_URL: 'http://localhost:3000',
  DATABASE_URL: TEST_DATABASE_URL,
  REDIS_URL: TEST_REDIS_URL,
  ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  SESSION_SECRET: randomBytes(32).toString('hex'),
  COOKIE_SECURE: 'false',
  AUTH_RATE_LIMIT_MAX: '1000',
} satisfies NodeJS.ProcessEnv
