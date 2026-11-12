import { can as canRole, type Language, type Permission, type Role } from '@raseel/shared'
import { defineStore } from 'pinia'

export interface CurrentUser {
  id: string
  name: string
  email: string
  role: Role
  language: Language
  active: boolean
  twoFactorEnabled: boolean
}

interface SetupStatus {
  setupCompleted: boolean
  business: { name: string; language: Language } | null
}

export const useAuthStore = defineStore('auth', () => {
  const api = useApi()
  const user = ref<CurrentUser | null>(null)
  const teams = ref<{ id: string; name: string }[]>([])
  const setup = ref<SetupStatus | null>(null)
  const loaded = ref(false)

  async function loadSetupStatus(force = false): Promise<SetupStatus> {
    if (!setup.value || force) setup.value = await api<SetupStatus>('/setup/status')
    return setup.value
  }

  async function fetchMe(): Promise<CurrentUser | null> {
    try {
      const res = await api<{ user: CurrentUser; teams: { id: string; name: string }[] }>(
        '/auth/me',
      )
      user.value = res.user
      teams.value = res.teams
    } catch {
      user.value = null
      teams.value = []
    } finally {
      loaded.value = true
    }
    return user.value
  }

  function setUser(next: CurrentUser) {
    user.value = next
    loaded.value = true
  }

  async function logout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined)
    useRealtime().disconnect()
    user.value = null
    teams.value = []
  }

  function can(permission: Permission): boolean {
    return user.value ? canRole(user.value.role, permission) : false
  }

  return { user, teams, setup, loaded, loadSetupStatus, fetchMe, setUser, logout, can }
})
