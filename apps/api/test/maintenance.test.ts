import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { runMaintenance } from '../src/jobs/maintenance.js'
import { createHarness, type Harness, setupOwner } from './harness.js'

let h: Harness

beforeAll(async () => {
  h = await createHarness()
})
afterAll(async () => {
  await h.close()
})
beforeEach(async () => {
  await h.reset()
})

describe('maintenance job', () => {
  it('deletes expired sessions but keeps active ones', async () => {
    await setupOwner(h)
    const owner = await h.ctx.db.user.findFirstOrThrow()
    await h.ctx.db.session.create({
      data: {
        id: 'expired',
        userId: owner.id,
        tokenHash: 'expired-hash',
        expiresAt: new Date(Date.now() - 1000),
      },
    })

    const result = await runMaintenance(h.ctx)

    expect(result.sessions).toBe(1)
    expect(await h.ctx.db.session.count()).toBe(1)
  })
})
