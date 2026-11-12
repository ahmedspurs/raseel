import { createHash, randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

/**
 * Applies pending SQL migrations from prisma/migrations at startup.
 *
 * Uses the same `_prisma_migrations` table and checksums as `prisma migrate deploy`,
 * so the two are interchangeable — but the production image does not need to ship
 * the Prisma CLI (≈300 MB), which keeps installs fast on a small VPS.
 */
const MIGRATION_LOCK = 72_018

export const DEFAULT_MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../prisma/migrations',
)

export interface MigrateResult {
  applied: string[]
  alreadyApplied: number
}

export async function migrate(
  databaseUrl: string,
  dir = DEFAULT_MIGRATIONS_DIR,
  log: (msg: string) => void = () => undefined,
): Promise<MigrateResult> {
  const client = new pg.Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    // Only one process migrates at a time (e.g. API restarting while an update runs).
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK])
    await client.query(`
      CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
        "id" VARCHAR(36) PRIMARY KEY NOT NULL,
        "checksum" VARCHAR(64) NOT NULL,
        "finished_at" TIMESTAMPTZ,
        "migration_name" VARCHAR(255) NOT NULL,
        "logs" TEXT,
        "rolled_back_at" TIMESTAMPTZ,
        "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
        "applied_steps_count" INTEGER NOT NULL DEFAULT 0
      )`)

    const { rows } = await client.query<{ migration_name: string; finished_at: Date | null }>(
      `SELECT migration_name, finished_at FROM "_prisma_migrations" WHERE rolled_back_at IS NULL`,
    )
    const failed = rows.filter((r) => !r.finished_at).map((r) => r.migration_name)
    if (failed.length) {
      throw new Error(
        `Migration ${failed.join(', ')} previously failed. Fix the database and mark it resolved before continuing.`,
      )
    }
    const done = new Set(rows.map((r) => r.migration_name))

    const names = (await readdir(dir, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()

    const applied: string[] = []
    for (const name of names) {
      if (done.has(name)) continue
      const sql = await readFile(path.join(dir, name, 'migration.sql'), 'utf8')
      const checksum = createHash('sha256').update(sql).digest('hex')
      const id = randomUUID()
      log(`applying migration ${name}`)
      await client.query(
        `INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at) VALUES ($1, $2, $3, now())`,
        [id, checksum, name],
      )
      try {
        await client.query('BEGIN')
        await client.query(sql)
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK')
        await client.query(`UPDATE "_prisma_migrations" SET logs = $2 WHERE id = $1`, [
          id,
          String((err as Error).message).slice(0, 4000),
        ])
        throw new Error(`Migration ${name} failed: ${(err as Error).message}`, { cause: err })
      }
      await client.query(
        `UPDATE "_prisma_migrations" SET finished_at = now(), applied_steps_count = 1 WHERE id = $1`,
        [id],
      )
      applied.push(name)
    }
    return { applied, alreadyApplied: done.size }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => undefined)
    await client.end()
  }
}

// CLI: `node dist/migrate.js`
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL is required')
    process.exit(1)
  }
  migrate(url, DEFAULT_MIGRATIONS_DIR, (m) => console.log(m))
    .then((r) =>
      console.log(
        r.applied.length
          ? `Applied ${r.applied.length} migration(s).`
          : `Database is up to date (${r.alreadyApplied} migrations).`,
      ),
    )
    .catch((err: Error) => {
      console.error(err.message)
      process.exit(1)
    })
}
