import pg from 'pg'
import { migrate } from '../src/migrate.js'
import { TEST_DATABASE_URL } from './env.js'

/** Creates the test database if needed and applies migrations once per run. */
export default async function setup() {
  const url = new URL(TEST_DATABASE_URL)
  const dbName = url.pathname.slice(1)
  const admin = new pg.Client({ connectionString: new URL('/postgres', url).toString() })
  await admin.connect()
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName])
  if (exists.rowCount === 0) await admin.query(`CREATE DATABASE "${dbName}"`)
  await admin.end()

  await migrate(TEST_DATABASE_URL)
}
