import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { runSweep } from '../src/jobs/sweep.js'
import { parseCsv } from '../src/lib/csv.js'
import { normalizePhone } from '../src/routes/contacts-csv.js'
import { EVENTS_CHANNEL } from '../src/services/events.js'
import { createHarness, createUser, type Harness, setupOwner } from './harness.js'

let h: Harness
let owner: string

beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => {
  await h.close()
})
beforeEach(async () => {
  await h.reset()
  owner = await setupOwner(h)
})

const api = (method: string, url: string, payload?: unknown, cookie = owner) =>
  h.app.inject({ method: method as 'GET', url, headers: { cookie }, payload: payload as object })

const newContact = async (waId = '966500000301', name = 'Fahad') =>
  (await api('POST', '/api/contacts', { waId, name })).json().contact.id as string

describe('deals pipeline (FR-33)', () => {
  it('creates a default pipeline and moves deals between stages in order', async () => {
    const { pipelines } = (await api('GET', '/api/pipelines')).json()
    const stages = pipelines[0].stages as { id: string; name: string; kind: string }[]
    expect(stages.map((s) => s.kind)).toEqual(['OPEN', 'OPEN', 'OPEN', 'OPEN', 'WON', 'LOST'])

    const contactId = await newContact()
    const create = (title: string, stageId: string) =>
      api('POST', '/api/deals', { title, contactId, stageId, valueSar: 1500.5 })
    const a = (await create('Implants', stages[0]!.id)).json().deal
    const b = (await create('Whitening', stages[1]!.id)).json().deal
    expect(a).toMatchObject({ valueSar: 1500.5, position: 0, contact: { name: 'Fahad' } })

    // Drop "Implants" at the top of the second column.
    const moved = await api('PATCH', `/api/deals/${a.id}`, { stageId: stages[1]!.id, position: 0 })
    expect(moved.json().deal).toMatchObject({ stageId: stages[1]!.id, position: 0 })
    const list = (await api('GET', '/api/deals')).json().deals as { id: string; position: number }[]
    expect(list.find((d) => d.id === b.id)?.position).toBe(1)

    const won = await api('PATCH', `/api/deals/${a.id}`, { stageId: stages[4]!.id })
    expect(won.json().deal.closedAt).toBeTruthy()
    expect(await h.ctx.db.auditLog.count({ where: { action: 'deal.won', target: a.id } })).toBe(1)
  })

  it('protects stages that still hold deals', async () => {
    const { pipelines } = (await api('GET', '/api/pipelines')).json()
    const p = pipelines[0]
    await api('POST', '/api/deals', {
      title: 'x',
      contactId: await newContact(),
      stageId: p.stages[0].id,
    })
    const res = await api('PUT', `/api/pipelines/${p.id}`, {
      name: p.name,
      stages: p.stages.slice(1).map((s: { id: string; name: string; kind: string }) => s),
    })
    expect(res.statusCode).toBe(409)

    const renamed = await api('PUT', `/api/pipelines/${p.id}`, {
      name: 'Sales',
      stages: [...p.stages.map((s: object) => s), { name: 'Follow-up', kind: 'OPEN' }],
    })
    expect(renamed.json().pipeline.stages).toHaveLength(7)
  })

  it('does not let viewers edit deals', async () => {
    const viewer = await createUser(h, owner, 'VIEWER')
    const { pipelines } = (await api('GET', '/api/pipelines', undefined, viewer)).json()
    const res = await api(
      'POST',
      '/api/deals',
      { title: 'x', contactId: await newContact(), stageId: pipelines[0].stages[0].id },
      viewer,
    )
    expect(res.statusCode).toBe(403)
  })
})

describe('tasks and reminders (FR-34)', () => {
  it('lists my open tasks and reminds once when due', async () => {
    const contactId = await newContact()
    const due = new Date(Date.now() - 60_000).toISOString()
    const task = (
      await api('POST', '/api/tasks', {
        title: 'اتصل بالعميل لتأكيد الموعد',
        contactId,
        dueAt: due,
      })
    ).json().task
    expect(task.assignee.name).toBe('Huda')

    const sub = h.ctx.redis.duplicate()
    const received: unknown[] = []
    await sub.subscribe(EVENTS_CHANNEL)
    sub.on('message', (_c, m) => received.push(JSON.parse(m)))

    expect((await runSweep(h.ctx)).reminders).toBe(1)
    expect((await runSweep(h.ctx)).reminders).toBe(0)
    await new Promise((r) => setTimeout(r, 100))
    expect(received).toContainEqual(expect.objectContaining({ type: 'task.due', taskId: task.id }))
    await sub.quit()

    await api('PATCH', `/api/tasks/${task.id}`, { done: true })
    const open = (await api('GET', '/api/tasks?done=false')).json().tasks
    expect(open).toHaveLength(0)
  })
})

describe('CSV import and export (FR-32)', () => {
  const upload = (csv: string, cookie = owner) => {
    const boundary = '----raseelcsv'
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="contacts.csv"',
      'Content-Type: text/csv',
      '',
      csv,
      `--${boundary}--`,
      '',
    ].join('\r\n')
    return h.app.inject({
      method: 'POST',
      url: '/api/contacts/import',
      headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    })
  }

  it('normalizes Saudi and international numbers', () => {
    expect(normalizePhone('0501234567')).toBe('966501234567')
    expect(normalizePhone('+966 50 123 4567')).toBe('966501234567')
    expect(normalizePhone('00971501112233')).toBe('971501112233')
    expect(normalizePhone('٠٥٠١٢٣٤٥٦٧')).toBe('966501234567')
    expect(normalizePhone('123')).toBeNull()
  })

  it('imports Arabic headers, creates tags, records consent only when stated', async () => {
    await api('POST', '/api/custom-fields', { key: 'branch', label: 'الفرع', type: 'TEXT' })
    const existing = await newContact('966501234567', 'Old name')
    const csv = [
      'الجوال,الاسم,المدينة,الوسوم,الموافقة,الفرع',
      '0501234567,سارة,الرياض,VIP|عيادة,نعم,العليا',
      '+971 50 111 2233,Omar,Dubai,VIP,,',
      'abc,Bad,,,,',
    ].join('\n')
    const res = await upload(csv)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      created: 1,
      updated: 1,
      optedIn: 1,
      errors: [{ row: 4, error: 'invalid_phone' }],
    })

    const sara = await h.ctx.db.contact.findUniqueOrThrow({
      where: { id: existing },
      include: { tags: { include: { tag: true } } },
    })
    expect(sara).toMatchObject({
      name: 'سارة',
      city: 'الرياض',
      optInMarketing: true,
      customFields: { branch: 'العليا' },
    })
    expect(sara.tags.map((t) => t.tag.name).sort()).toEqual(['VIP', 'عيادة'])
    const omar = await h.ctx.db.contact.findUniqueOrThrow({ where: { waId: '971501112233' } })
    expect(omar.optInMarketing).toBe(false)
  })

  it('rejects files without a phone column and non-admins', async () => {
    expect((await upload('name,city\nA,B')).json().error).toBe('phone_column_missing')
    const agent = await createUser(h, owner, 'AGENT')
    expect((await upload('phone\n0501234567', agent)).statusCode).toBe(403)
  })

  it('exports every contact as CSV for the owner only', async () => {
    await api('POST', '/api/contacts', { waId: '966500000399', name: '=cmd()' })
    const res = await api('GET', '/api/contacts/export.csv')
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/csv')
    const rows = parseCsv(res.body)
    expect(rows[0]!.slice(0, 3)).toEqual(['phone', 'name', 'whatsapp_name'])
    expect(rows[1]!.slice(0, 2)).toEqual(['+966500000399', "'=cmd()"])

    const admin = await createUser(h, owner, 'ADMIN')
    expect((await api('GET', '/api/contacts/export.csv', undefined, admin)).statusCode).toBe(403)
  })
})
