import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrate } from '../src/migrate.js'
import { TEST_DATABASE_URL } from './env.js'

const DB = 'raseel_migrate_test'
const url = new URL(TEST_DATABASE_URL)
url.pathname = `/${DB}`
const admin = () => {
  const u = new URL(TEST_DATABASE_URL)
  u.pathname = '/postgres'
  return new pg.Client({ connectionString: u.toString() })
}

let dir: string

beforeAll(async () => {
  const c = admin()
  await c.connect()
  await c.query(`DROP DATABASE IF EXISTS "${DB}"`)
  await c.query(`CREATE DATABASE "${DB}"`)
  await c.end()
  dir = await mkdtemp(path.join(tmpdir(), 'raseel-migrations-'))
})
afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
  const c = admin()
  await c.connect()
  await c.query(`DROP DATABASE IF EXISTS "${DB}"`)
  await c.end()
})

async function addMigration(name: string, sql: string) {
  await mkdir(path.join(dir, name), { recursive: true })
  await writeFile(path.join(dir, name, 'migration.sql'), sql)
}

describe('migrate', () => {
  it('applies the real migrations on an empty database, then is a no-op', async () => {
    const first = await migrate(url.toString())
    expect(first.applied.length).toBeGreaterThan(0)
    const second = await migrate(url.toString())
    expect(second.applied).toEqual([])
  })

  it('applies new migrations in order and stops on a failure', async () => {
    await addMigration('001_a', 'CREATE TABLE t_a (id int);')
    await addMigration('002_b', 'CREATE TABLE t_b (id int);')
    const res = await migrate(url.toString(), dir)
    expect(res.applied).toEqual(['001_a', '002_b'])

    await addMigration('003_bad', 'CREATE TABLE t_a (id int);')
    await expect(migrate(url.toString(), dir)).rejects.toThrow('003_bad failed')
    // A failed migration blocks later runs until it is resolved.
    await expect(migrate(url.toString(), dir)).rejects.toThrow('previously failed')
  })
})
