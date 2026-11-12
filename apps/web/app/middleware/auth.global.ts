const PUBLIC_ROUTES = new Set(['/login', '/setup'])

/**
 * Sends visitors to the setup wizard on a fresh install, to the login page
 * when signed out, and away from auth pages when already signed in.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  const auth = useAuthStore()
  const isPublic = PUBLIC_ROUTES.has(to.path) || to.path.startsWith('/invite/')

  let status
  try {
    status = await auth.loadSetupStatus()
  } catch {
    // API unreachable: let the page render and show its own error state.
    return
  }

  if (!status.setupCompleted) {
    return to.path === '/setup' ? undefined : navigateTo('/setup')
  }
  if (to.path === '/setup') return navigateTo('/login')

  if (!auth.loaded) await auth.fetchMe()

  if (!auth.user && !isPublic) {
    return navigateTo({ path: '/login', query: to.path !== '/' ? { next: to.fullPath } : {} })
  }
  if (auth.user && isPublic) return navigateTo('/inbox')
})
