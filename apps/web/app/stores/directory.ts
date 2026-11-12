import type { Role } from '@raseel/shared'
import { defineStore } from 'pinia'

export interface StaffMember {
  id: string
  name: string
  email: string
  role: Role
  active: boolean
  teamIds: string[]
}
export interface TeamInfo {
  id: string
  name: string
  memberIds: string[]
}
export interface QuickReply {
  id: string
  shortcut: string
  title: string
  body: string
  language: 'ar' | 'en' | null
}

/** Colleagues, teams and quick replies, loaded once and shared by inbox screens. */
export const useDirectoryStore = defineStore('directory', () => {
  const api = useApi()
  const users = ref<StaffMember[]>([])
  const teams = ref<TeamInfo[]>([])
  const quickReplies = ref<QuickReply[]>([])
  const loaded = ref(false)

  async function load(force = false) {
    if (loaded.value && !force) return
    const [u, t, q] = await Promise.all([
      api<{ users: StaffMember[] }>('/users'),
      api<{ teams: TeamInfo[] }>('/teams'),
      api<{ quickReplies: QuickReply[] }>('/quick-replies'),
    ])
    users.value = u.users
    teams.value = t.teams
    quickReplies.value = q.quickReplies
    loaded.value = true
  }

  const userName = (id: string | null | undefined) =>
    users.value.find((u) => u.id === id)?.name ?? null
  const teamName = (id: string | null | undefined) =>
    teams.value.find((t) => t.id === id)?.name ?? null
  /** Staff who can be assigned conversations (not viewers, not deactivated). */
  const assignable = computed(() => users.value.filter((u) => u.active && u.role !== 'VIEWER'))

  return { users, teams, quickReplies, loaded, load, userName, teamName, assignable }
})
