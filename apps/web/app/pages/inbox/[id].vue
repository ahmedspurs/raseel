<script setup lang="ts">
import { customerWindow } from '@raseel/shared'
import type { ContactInfo } from '~/types/crm'
import type { ConversationSummary, InboxMessage, InboxNote, PresenceViewer } from '~/types/inbox'

const route = useRoute()
const api = useApi()
const inbox = useInboxStore()
const auth = useAuthStore()
const directory = useDirectoryStore()
const mentions = useMentionsStore()
const realtime = useRealtime()

const id = computed(() => String(route.params.id))
const conversation = ref<ConversationSummary | null>(null)
const messages = ref<InboxMessage[]>([])
const notes = ref<InboxNote[]>([])
const viewers = ref<PresenceViewer[]>([])
const hasMore = ref(false)
const loadingOlder = ref(false)
const notFound = ref(false)
const scroller = ref<HTMLElement | null>(null)
const showTemplate = ref(false)
const contactInfo = ref<ContactInfo | null>(null)
watch(showTemplate, async (open) => {
  if (open && conversation.value) {
    contactInfo.value = (
      await api<{ contact: ContactInfo }>(`/contacts/${conversation.value.contact.id}`)
    ).contact
  }
})

type TimelineItem =
  | { kind: 'message'; at: string; key: string; message: InboxMessage }
  | { kind: 'note'; at: string; key: string; note: InboxNote }

/** Customer messages, replies and internal notes in one chronological thread. */
const timeline = computed<TimelineItem[]>(() => {
  const firstLoaded = messages.value[0]?.createdAt
  const items: TimelineItem[] = [
    ...messages.value.map((m) => ({
      kind: 'message' as const,
      at: m.createdAt,
      key: `m-${m.id}`,
      message: m,
    })),
    // Hide notes older than the loaded messages so the thread stays consistent.
    ...notes.value
      .filter((n) => !hasMore.value || !firstLoaded || n.createdAt >= firstLoaded)
      .map((n) => ({ kind: 'note' as const, at: n.createdAt, key: `n-${n.id}`, note: n })),
  ]
  return items.sort((a, b) => a.at.localeCompare(b.at))
})

const windowOpen = computed(() => customerWindow(conversation.value?.lastInboundAt ?? null).open)

function isNearBottom() {
  const el = scroller.value
  return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 160
}
async function scrollToBottom() {
  await nextTick()
  if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight
}

async function markRead() {
  if (!conversation.value?.unreadCount) return
  conversation.value.unreadCount = 0
  inbox.markRead(id.value)
  await api(`/conversations/${id.value}/read`, { method: 'POST' }).catch(() => undefined)
}

async function load() {
  notFound.value = false
  try {
    const [conv, msgs, n] = await Promise.all([
      api<{ conversation: ConversationSummary }>(`/conversations/${id.value}`),
      api<{ messages: InboxMessage[]; hasMore: boolean }>(`/conversations/${id.value}/messages`),
      api<{ notes: InboxNote[] }>(`/conversations/${id.value}/notes`),
    ])
    conversation.value = conv.conversation
    messages.value = msgs.messages
    hasMore.value = msgs.hasMore
    notes.value = n.notes
    await scrollToBottom()
    await markRead()
    if (mentions.unread) await mentions.markRead(id.value)
  } catch {
    notFound.value = true
  }
}

async function loadOlder() {
  const first = messages.value[0]
  if (!first) return
  loadingOlder.value = true
  const el = scroller.value
  const previousHeight = el?.scrollHeight ?? 0
  try {
    const res = await api<{ messages: InboxMessage[]; hasMore: boolean }>(
      `/conversations/${id.value}/messages`,
      { query: { before: first.id } },
    )
    messages.value = [...res.messages, ...messages.value]
    hasMore.value = res.hasMore
    await nextTick()
    if (el) el.scrollTop = el.scrollHeight - previousHeight
  } finally {
    loadingOlder.value = false
  }
}

function upsertMessage(message: InboxMessage) {
  const i = messages.value.findIndex((m) => m.id === message.id)
  if (i >= 0) messages.value[i] = message
  else messages.value.push(message)
}

// ── Realtime ──
realtime.on<{ conversationId: string; message: InboxMessage }>('message', async (e) => {
  if (e.conversationId !== id.value) return
  const stick = isNearBottom()
  upsertMessage(e.message)
  if (stick) await scrollToBottom()
  if (e.message.direction === 'INBOUND' && document.visibilityState === 'visible') {
    // The conversation is open: the agent has seen it.
    setTimeout(() => void markRead(), 300)
  }
})
realtime.on<{ conversation: ConversationSummary }>('conversation', (e) => {
  if (e.conversation.id === id.value) conversation.value = e.conversation
})
realtime.on<{ note: InboxNote }>('note', async (e) => {
  if (e.note.conversationId !== id.value || notes.value.some((n) => n.id === e.note.id)) return
  const stick = isNearBottom()
  notes.value.push(e.note)
  if (stick) await scrollToBottom()
})
realtime.on<{ conversationId: string; viewers: PresenceViewer[] }>('presence', (e) => {
  if (e.conversationId === id.value) viewers.value = e.viewers
})
// After a reconnect: rejoin the room and catch up on anything missed.
realtime.on('connect', () => {
  realtime.socket()?.emit('conversation:join', id.value)
  void load()
})

watch(
  id,
  async (next) => {
    messages.value = []
    notes.value = []
    viewers.value = []
    conversation.value = null
    realtime.connect().emit('conversation:join', next)
    await load()
  },
  { immediate: true },
)
onBeforeUnmount(() => realtime.socket()?.emit('conversation:leave'))

async function onSent(message: InboxMessage) {
  upsertMessage(message)
  await scrollToBottom()
}
async function onNoted(note: InboxNote) {
  if (!notes.value.some((n) => n.id === note.id)) notes.value.push(note)
  await scrollToBottom()
}
async function retry(messageId: string) {
  await api(`/conversations/${id.value}/messages/${messageId}/retry`, { method: 'POST' })
}
function onUpdated(c: ConversationSummary) {
  conversation.value = c
  inbox.applyConversation(c)
}

onMounted(() => void directory.load())
useHead({ title: () => conversation.value?.contact.name ?? '' })
</script>

<template>
  <div class="flex min-w-0 flex-1 flex-col bg-slate-100 dark:bg-slate-950">
    <div v-if="notFound" class="grid flex-1 place-items-center p-6 text-slate-500">
      {{ $t('errors.not_found') }}
    </div>

    <template v-else-if="conversation">
      <ConversationHeader :conversation="conversation" :viewers="viewers" @updated="onUpdated" />

      <div ref="scroller" class="flex-1 space-y-2 overflow-y-auto px-3 py-4 sm:px-6">
        <div v-if="hasMore" class="flex justify-center">
          <button
            type="button"
            class="btn-secondary py-1.5 text-xs"
            :disabled="loadingOlder"
            @click="loadOlder"
          >
            {{ $t('inbox.loadOlder') }}
          </button>
        </div>
        <template v-for="item in timeline" :key="item.key">
          <MessageBubble v-if="item.kind === 'message'" :message="item.message" @retry="retry" />
          <NoteBubble v-else :note="item.note" />
        </template>
      </div>

      <div
        v-if="!windowOpen && auth.can('conversations:reply')"
        class="flex flex-wrap items-center justify-between gap-2 border-t border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
      >
        <span>{{
          conversation.lastInboundAt ? $t('inbox.windowClosed') : $t('inbox.windowNever')
        }}</span>
        <button type="button" class="btn-primary py-1.5 text-xs" @click="showTemplate = true">
          {{ $t('inbox.sendTemplate') }}
        </button>
      </div>
      <MessageComposer
        v-if="auth.can('conversations:reply') || auth.can('notes:write')"
        :key="id"
        :conversation-id="id"
        :can-reply="auth.can('conversations:reply')"
        :can-note="auth.can('notes:write')"
        :window-open="windowOpen"
        @sent="onSent"
        @noted="onNoted"
      />
      <TemplateSender
        v-if="showTemplate && contactInfo"
        :contact="contactInfo"
        @close="showTemplate = false"
        @sent="showTemplate = false"
      />
    </template>
  </div>
</template>
