import { readdir, readFile } from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { normalizeSearch } from '@raseel/shared'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_MIGRATIONS_DIR } from '../src/migrate.js'
import { fakeWamid } from '../src/whatsapp/fixtures.js'
import { createHarness, createUser, type Harness, setupOwner } from './harness.js'

let h: Harness
let owner: string
let mediaDir: string

beforeAll(async () => {
  mediaDir = await mkdtemp(path.join(tmpdir(), 'raseel-contacts-'))
  h = await createHarness({ MEDIA_DIR: mediaDir })
})
afterAll(async () => {
  await h.close()
  await rm(mediaDir, { recursive: true, force: true })
})
beforeEach(async () => {
  await h.reset()
  owner = await setupOwner(h)
})

const say = (from: string, profileName: string, body: string) =>
  h.ctx.inbound.handleMessage({
    waMessageId: fakeWamid(),
    from,
    profileName,
    timestamp: new Date(),
    type: 'TEXT',
    body,
    payload: null,
    media: null,
    replyToWaId: null,
  })

const api = (method: string, url: string, payload?: unknown, cookie = owner) =>
  h.app.inject({ method: method as 'GET', url, headers: { cookie }, payload: payload as object })

describe('contacts (FR-31)', () => {
  it('finds contacts regardless of Arabic spelling variants', async () => {
    await say('966500000001', 'أحمد العتيبي', 'hi')
    await say('966500000002', 'سارة', 'hi')

    const byName = await api('GET', '/api/contacts?q=احمد')
    expect(byName.json().contacts.map((c: { waId: string }) => c.waId)).toEqual(['966500000001'])

    const byTaa = await api('GET', '/api/contacts?q=ساره')
    expect(byTaa.json().total).toBe(1)

    const byNumber = await api('GET', `/api/contacts?q=${encodeURIComponent('٥٠٠٠٠٠٠٠٢')}`)
    expect(byNumber.json().contacts[0].waId).toBe('966500000002')
  })

  it('updates profile, tags and validated custom fields', async () => {
    await say('966500000003', 'Noura', 'hi')
    const contact = await h.ctx.db.contact.findFirstOrThrow()

    const tag = (await api('POST', '/api/tags', { name: 'VIP', color: '#f59e0b' })).json().tag
    await api('POST', '/api/custom-fields', {
      key: 'plan',
      label: 'الباقة',
      type: 'SELECT',
      options: ['ذهبية', 'فضية'],
    })
    await api('POST', '/api/custom-fields', { key: 'visits', label: 'Visits', type: 'NUMBER' })

    const bad = await api('PATCH', `/api/contacts/${contact.id}`, {
      customFields: { plan: 'برونزية' },
    })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().fields).toEqual(['plan'])

    const res = await api('PATCH', `/api/contacts/${contact.id}`, {
      name: 'نورة الشمري',
      company: 'مؤسسة النخبة',
      city: 'الرياض',
      tagIds: [tag.id],
      customFields: { plan: 'ذهبية', visits: '4', unknown: 'x' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().contact).toMatchObject({
      displayName: 'نورة الشمري',
      tags: [{ name: 'VIP' }],
      customFields: { plan: 'ذهبية', visits: 4 },
    })

    // Search follows the edited profile.
    expect((await api('GET', '/api/contacts?q=النخبه')).json().total).toBe(1)
    expect((await api('GET', `/api/contacts?tagId=${tag.id}`)).json().total).toBe(1)
  })

  it('records marketing consent with timestamps and audit entries', async () => {
    await say('966500000004', 'Ali', 'hi')
    const contact = await h.ctx.db.contact.findFirstOrThrow()
    await api('PATCH', `/api/contacts/${contact.id}`, { optInMarketing: true })
    const after = await h.ctx.db.contact.findUniqueOrThrow({ where: { id: contact.id } })
    expect(after.optInMarketing).toBe(true)
    expect(after.optedInAt).toBeTruthy()
    expect(
      await h.ctx.db.auditLog.count({ where: { action: 'contact.opted_in', target: contact.id } }),
    ).toBe(1)
  })

  it('creates a contact from a typed number and refuses duplicates', async () => {
    const res = await api('POST', '/api/contacts', { waId: '+966 55 123 4567', name: 'Fahad' })
    expect(res.statusCode).toBe(201)
    expect(res.json().contact.waId).toBe('966551234567')
    const dup = await api('POST', '/api/contacts', { waId: '966551234567' })
    expect(dup.statusCode).toBe(409)
  })

  it('lets agents edit but not delete or export (NFR-10)', async () => {
    const agent = await createUser(h, owner, 'AGENT')
    await say('966500000005', 'Huda', 'hi')
    const contact = await h.ctx.db.contact.findFirstOrThrow()
    expect(
      (await api('PATCH', `/api/contacts/${contact.id}`, { city: 'Jeddah' }, agent)).statusCode,
    ).toBe(200)
    expect((await api('DELETE', `/api/contacts/${contact.id}`, undefined, agent)).statusCode).toBe(
      403,
    )
    expect(
      (await api('GET', `/api/contacts/${contact.id}/export`, undefined, agent)).statusCode,
    ).toBe(403)
  })

  it('exports and permanently deletes a contact with their messages and media (NFR-10)', async () => {
    await say('966500000006', 'Reem', 'my order number is 5521')
    const contact = await h.ctx.db.contact.findFirstOrThrow()
    const message = await h.ctx.db.message.findFirstOrThrow()
    const mediaPath = await h.ctx.media.save(message.id, new Uint8Array([1, 2, 3]), 'image/png')
    await h.ctx.db.message.update({ where: { id: message.id }, data: { mediaPath } })

    const exported = await api('GET', `/api/contacts/${contact.id}/export`)
    expect(exported.statusCode).toBe(200)
    expect(exported.headers['content-disposition']).toContain('attachment')
    expect(exported.json().conversations[0].messages[0].body).toBe('my order number is 5521')

    const del = await api('DELETE', `/api/contacts/${contact.id}`)
    expect(del.statusCode).toBe(200)
    expect(await h.ctx.db.contact.count()).toBe(0)
    expect(await h.ctx.db.message.count()).toBe(0)
    await expect(readFile(h.ctx.media.resolve(mediaPath))).rejects.toThrow()
    const log = await h.ctx.db.auditLog.findFirstOrThrow({ where: { action: 'contact.deleted' } })
    expect(log.target).toBe(contact.id)
  })
})

describe('search (FR-20)', () => {
  it('finds messages and contacts with Arabic-aware matching', async () => {
    await say('966500000010', 'Fatimah', 'أبغى أحجز موعد عند طبيب الأسنان')
    await say('966500000011', 'Majed', 'كم سعر التنظيف؟')

    const res = await api('GET', `/api/search?q=${encodeURIComponent('اسنان موعد')}`)
    expect(res.json().messages).toEqual([
      expect.objectContaining({
        body: 'أبغى أحجز موعد عند طبيب الأسنان',
        contact: expect.objectContaining({ name: 'Fatimah' }),
      }),
    ])
    const contacts = await api('GET', '/api/search?q=majed')
    expect(contacts.json().contacts[0].waId).toBe('966500000011')
  })

  it('filters the inbox by contact tag (FR-14)', async () => {
    await say('966500000012', 'Tagged', 'hi')
    await say('966500000013', 'Untagged', 'hi')
    const tag = (await api('POST', '/api/tags', { name: 'Lead' })).json().tag
    const tagged = await h.ctx.db.contact.findUniqueOrThrow({ where: { waId: '966500000012' } })
    await api('PATCH', `/api/contacts/${tagged.id}`, { tagIds: [tag.id] })

    const list = await api('GET', `/api/conversations?view=all&tagId=${tag.id}`)
    expect(
      list.json().conversations.map((c: { contact: { waId: string } }) => c.contact.waId),
    ).toEqual(['966500000012'])
  })

  it('backfills existing rows with the same normalization as the app', async () => {
    const dir = (await readdir(DEFAULT_MIGRATIONS_DIR)).find((d) => d.includes('crm_search'))!
    const sql = await readFile(path.join(DEFAULT_MIGRATIONS_DIR, dir, 'migration.sql'), 'utf8')
    // Pull the normalization expression out of the backfill and run it on samples.
    const expr = sql.match(/SET "search_text" = NULLIF\(([\s\S]+?), ''\)\nWHERE/)![1]!
    const samples = ['سارة أحمد', 'مُسْتَشْفَى الإيمان', 'هاتف ٠٥٥١٢٣ ۴۵', 'ABC  Def', 'مؤسسة رئيسية']
    for (const sample of samples) {
      const rows = await h.ctx.db.$queryRawUnsafe<{ v: string }[]>(
        `SELECT ${expr.replaceAll('"body"', '$1::text')} AS v`,
        sample,
      )
      expect(rows[0]!.v).toBe(normalizeSearch(sample))
    }
  })
})
