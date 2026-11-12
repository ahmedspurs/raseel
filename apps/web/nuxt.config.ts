import tailwindcss from '@tailwindcss/vite'

/** Where the dev server forwards API calls; override when port 4000 is taken. */
const api = process.env.RASEEL_API_ORIGIN ?? 'http://localhost:4000'

export default defineNuxtConfig({
  compatibilityDate: '2026-11-01',
  // The inbox is an authenticated app: render on the client and ship static files that
  // Caddy serves directly, so the 1 vCPU VPS only runs the API and worker (NFR-03).
  ssr: false,
  devtools: { enabled: false },
  telemetry: false,
  modules: ['@pinia/nuxt', '@nuxtjs/i18n'],
  css: ['~/assets/css/main.css'],
  vite: { plugins: [tailwindcss()] },
  app: {
    head: {
      title: 'Raseel',
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'theme-color', content: '#0f766e' },
        { name: 'description', content: 'Self-hosted WhatsApp team inbox and CRM' },
      ],
      link: [{ rel: 'icon', type: 'image/svg+xml', href: '/icon.svg' }],
    },
  },
  i18n: {
    strategy: 'no_prefix',
    defaultLocale: 'ar',
    locales: [
      { code: 'ar', language: 'ar-SA', dir: 'rtl', name: 'العربية', file: 'ar.json' },
      { code: 'en', language: 'en-US', dir: 'ltr', name: 'English', file: 'en.json' },
    ],
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: 'raseel_lang',
      fallbackLocale: 'ar',
    },
  },
  nitro: {
    devProxy: {
      '/api': { target: `${api}/api`, changeOrigin: true },
      '/health': { target: `${api}/health`, changeOrigin: true },
      '/webhooks': { target: `${api}/webhooks`, changeOrigin: true },
      '/socket.io': { target: `${api}/socket.io`, ws: true, changeOrigin: true },
    },
  },
  typescript: { strict: true },
})
