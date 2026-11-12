import type { InboxView } from '@raseel/shared'
import { defineStore } from 'pinia'
import type { ConversationSummary } from '~/types/inbox'

export interface InboxFilters {
  status: '' | 'OPEN' | 'PENDING'
  assigneeId: string
  teamId: string
  tagId: string
  from: string
  to: string
}

const emptyFilters = (): InboxFilters => ({
  status: '',
  assigneeId: '',
  teamId: '',
  tagId: '',
  from: '',
  to: '',
})

export const useInboxStore = defineStore('inbox', () => {
  const api = useApi()
  const conversations = ref<ConversationSummary[]>([])
  const counts = ref<Partial<Record<InboxView, number>>>({})
  // Agents start with their own queue; owners and admins oversee everything.
  const view = ref<InboxView>(useAuthStore().user?.role === 'AGENT' ? 'mine' : 'all')
  const filters = reactive<InboxFilters>(emptyFilters())
  const loading = ref(false)
  const loaded = ref(false)
  const connected = ref<boolean | null>(null)

  const activeFilterCount = computed(() => Object.values(filters).filter((v) => v !== '').length)

  function query() {
    const q: Record<string, string | number> = { view: view.value, limit: 100 }
    for (const [k, v] of Object.entries(filters)) if (v) q[k] = v
    return q
  }

  async function refresh() {
    loading.value = true
    try {
      const [list, c] = await Promise.all([
        api<{ conversations: ConversationSummary[] }>('/conversations', { query: query() }),
        api<{ counts: Record<InboxView, number> }>('/conversations/counts'),
      ])
      conversations.value = list.conversations
      counts.value = c.counts
      loaded.value = true
    } finally {
      loading.value = false
    }
  }

  // Many realtime events can arrive at once; refresh the list at most every 400 ms.
  let pending: ReturnType<typeof setTimeout> | undefined
  function scheduleRefresh() {
    clearTimeout(pending)
    pending = setTimeout(() => void refresh(), 400)
  }

  /** Applies a pushed conversation in place, then re-syncs list membership and counts. */
  function applyConversation(c: ConversationSummary) {
    const i = conversations.value.findIndex((x) => x.id === c.id)
    if (i >= 0) conversations.value[i] = c
    scheduleRefresh()
  }

  async function checkConnection() {
    const res = await api<{ connected: boolean }>('/whatsapp/status').catch(() => null)
    connected.value = res?.connected ?? null
  }

  function markRead(id: string) {
    const c = conversations.value.find((x) => x.id === id)
    if (c) c.unreadCount = 0
  }

  function clearFilters() {
    Object.assign(filters, emptyFilters())
  }

  watch([view, filters], () => void refresh(), { deep: true })

  return {
    conversations,
    counts,
    view,
    filters,
    activeFilterCount,
    loading,
    loaded,
    connected,
    refresh,
    applyConversation,
    checkConnection,
    markRead,
    clearFilters,
  }
})
