import { defineStore } from 'pinia'

export interface MentionItem {
  noteId: string
  conversationId: string
  contactName: string | null
  author: { id: string; name: string } | null
  body: string
  createdAt: string
  readAt: string | null
}

export const useMentionsStore = defineStore('mentions', () => {
  const api = useApi()
  const items = ref<MentionItem[]>([])
  const unread = ref(0)

  async function refresh() {
    const res = await api<{ unread: number; mentions: MentionItem[] }>('/mentions').catch(
      () => null,
    )
    if (!res) return
    items.value = res.mentions
    unread.value = res.unread
  }

  async function markRead(conversationId?: string) {
    await api('/mentions/read', { method: 'POST', body: conversationId ? { conversationId } : {} })
    await refresh()
  }

  return { items, unread, refresh, markRead }
})
