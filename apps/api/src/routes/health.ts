import type { FastifyPluginAsync } from 'fastify'

/** NFR-15: liveness and readiness checks for Docker and uptime monitors. */
export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', { config: { rateLimit: false } }, async () => ({ status: 'ok' }))

  app.get('/health/ready', { config: { rateLimit: false } }, async (_req, reply) => {
    const checks = await Promise.allSettled([app.ctx.db.$queryRaw`SELECT 1`, app.ctx.redis.ping()])
    const [database, redis] = checks.map((c) => (c.status === 'fulfilled' ? 'ok' : 'down'))
    const healthy = database === 'ok' && redis === 'ok'
    return reply
      .code(healthy ? 200 : 503)
      .send({ status: healthy ? 'ok' : 'degraded', database, redis })
  })
}
