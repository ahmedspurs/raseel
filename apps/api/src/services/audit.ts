import type { Db, Prisma } from '../lib/db.js'

export interface AuditEntry {
  userId?: string | null
  action: string
  target?: string | null
  meta?: Prisma.InputJsonValue
  ip?: string | null
}

/** Append-only log of logins, assignments, deletions and settings changes (FR-62). */
export class AuditService {
  constructor(private readonly db: Db) {}

  async log(entry: AuditEntry): Promise<void> {
    await this.db.auditLog.create({
      data: {
        userId: entry.userId ?? null,
        action: entry.action,
        target: entry.target ?? null,
        meta: entry.meta,
        ip: entry.ip ?? null,
      },
    })
  }
}
