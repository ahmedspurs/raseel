import { buildApp } from './app.js'
import { closeContext, createContext } from './bootstrap.js'

const ctx = createContext()
const app = await buildApp(ctx)

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down')
  await app.close()
  await closeContext(ctx)
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

await app.listen({ host: ctx.config.HOST, port: ctx.config.PORT })
