import { pino } from 'pino'
import type { Config } from '../config.js'

/** Structured JSON logs to stdout (NFR-15). */
export function createLogger(config: Pick<Config, 'LOG_LEVEL'>) {
  return pino({ level: config.LOG_LEVEL })
}
