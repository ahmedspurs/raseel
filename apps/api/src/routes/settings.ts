import { type BusinessSettings, businessSettingsSchema } from '@raseel/shared'
import type { FastifyPluginAsync } from 'fastify'
import { currentUser, requireAuth, requirePermission } from '../plugins/auth.js'
import { SettingKey } from '../services/settings.js'

export const settingsRoutes: FastifyPluginAsync = async (app) => {
  const { settings, audit } = app.ctx

  app.get('/business', { preHandler: requireAuth }, async () => {
    return { business: await settings.getJson<BusinessSettings>(SettingKey.Business) }
  })

  app.put('/business', { preHandler: requirePermission('settings:manage') }, async (req) => {
    const input = businessSettingsSchema.parse(req.body)
    await settings.setJson(SettingKey.Business, input)
    await audit.log({
      userId: currentUser(req).id,
      action: 'settings.business_updated',
      ip: req.ip,
    })
    return { business: input }
  })
}
