import { defineStore } from 'pinia'
import type { ConversationStatus, ConversationSummary } from '~/types/inbox'

export type InboxFilter = ConversationStatus | 'ALL'

export const useInboxStore = defineStore('inbox', () => {
  const api = useApi()
  const conversations = ref<ConversationSummary[]>([])
  const filter = ref<InboxFilter>('OPEN')
  const loading = ref(false)
  const loaded = ref(false)
  const connected = ref<boolean | null>(null)

  async function refresh() {
    loading.value = true
    try {
      const res = await api<{ conversations: ConversationSummary[] }>('/conversations', {
        query: { status: filter.value, limit: 100 },
      })
      conversations.value = res.conversations
      loaded.value = true
    } finally {
      loading.value = false
    }
  }

  async function checkConnection() {
    const res = await api<{ connected: boolean }>('/whatsapp/status').catch(() => null)
    connected.value = res?.connected ?? null
  }

  function markRead(id: string) {
    const c = conversations.value.find((x) => x.id === id)
    if (c) c.unreadCount = 0
  }

  watch(filter, () => void refresh())

  return { conversations, filter, loading, loaded, connected, refresh, checkConnection, markRead }
})
