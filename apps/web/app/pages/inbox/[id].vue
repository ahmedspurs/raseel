<script setup lang="ts">
import { customerWindow } from '@raseel/shared'
import type { ConversationSummary, InboxMessage } from '~/types/inbox'

const route = useRoute()
const api = useApi()
const inbox = useInboxStore()
const auth = useAuthStore()
const { duration } = useFormat()

const id = computed(() => String(route.params.id))
const conversation = ref<ConversationSummary | null>(null)
const messages = ref<InboxMessage[]>([])
const hasMore = ref(false)
const loadingOlder = ref(false)
const scroller = ref<HTMLElement | null>(null)
const now = ref(Date.now())

const windowState = computed(() =>
  customerWindow(conversation.value?.lastInboundAt ?? null, new Date(now.value)),
)
const canReply = computed(() => auth.can('conversations:reply'))

function isNearBottom() {
  const el = scroller.value
  return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 120
}

async function scrollToBottom() {
  await nextTick()
  if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight
}

async function load(initial = false) {
  const stick = initial || isNearBottom()
  const [conv, msgs] = await Promise.all([
    api<{ conversation: ConversationSummary }>(`/conversations/${id.value}`),
    api<{ messages: InboxMessage[]; hasMore: boolean }>(`/conversations/${id.value}/messages`),
  ])
  conversation.value = conv.conversation
  // Keep older pages already loaded; replace the newest page with fresh data.
  const fresh = new Map(msgs.messages.map((m) => [m.id, m]))
  const older = messages.value.filter(
    (m) => !fresh.has(m.id) && m.createdAt < (msgs.messages[0]?.createdAt ?? ''),
  )
  messages.value = [...older, ...msgs.messages]
  if (initial) hasMore.value = msgs.hasMore
  if (conv.conversation.unreadCount > 0) {
    await api(`/conversations/${id.value}/read`, { method: 'POST' }).catch(() => undefined)
    inbox.markRead(id.value)
  }
  if (stick) await scrollToBottom()
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

async function onSent(message: InboxMessage) {
  messages.value.push(message)
  await scrollToBottom()
  void inbox.refresh()
}

async function retry(messageId: string) {
  await api(`/conversations/${id.value}/messages/${messageId}/retry`, { method: 'POST' })
  await load()
}

let poll: ReturnType<typeof setInterval> | undefined
let clock: ReturnType<typeof setInterval> | undefined
watch(
  id,
  async () => {
    messages.value = []
    conversation.value = null
    await load(true)
  },
  { immediate: true },
)
onMounted(() => {
  poll = setInterval(() => void load(), 3000)
  clock = setInterval(() => (now.value = Date.now()), 30_000)
})
onBeforeUnmount(() => {
  clearInterval(poll)
  clearInterval(clock)
})

useHead({ title: () => conversation.value?.contact.name ?? '' })
</script>

<template>
  <div class="flex min-w-0 flex-1 flex-col bg-slate-100 dark:bg-slate-950">
    <header
      v-if="conversation"
      class="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900"
    >
      <NuxtLink
        to="/inbox"
        class="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 md:hidden"
        :aria-label="$t('inbox.back')"
      >
        <svg
          viewBox="0 0 24 24"
          class="size-5 rtl:rotate-180"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="m15 18-6-6 6-6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </NuxtLink>
      <span
        class="grid size-10 place-items-center rounded-full bg-slate-200 text-sm font-semibold dark:bg-slate-700"
      >
        {{ initials(conversation.contact.name) }}
      </span>
      <div class="min-w-0 flex-1">
        <p class="truncate font-semibold">
          {{ conversation.contact.name ?? `+${conversation.contact.waId}` }}
        </p>
        <p class="ltr text-xs text-slate-500">+{{ conversation.contact.waId }}</p>
      </div>
      <span
        class="badge hidden sm:inline-flex"
        :class="
          windowState.open ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
        "
      >
        {{
          windowState.open
            ? $t('inbox.windowOpen', { time: duration(windowState.remainingMs) })
            : $t('inbox.windowClosedShort')
        }}
      </span>
    </header>

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
      <MessageBubble v-for="m in messages" :key="m.id" :message="m" @retry="retry" />
    </div>

    <template v-if="canReply && conversation">
      <p
        v-if="!windowState.open"
        class="border-t border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
      >
        {{ conversation.lastInboundAt ? $t('inbox.windowClosed') : $t('inbox.windowNever') }}
      </p>
      <MessageComposer v-else :conversation-id="id" @sent="onSent" />
    </template>
  </div>
</template>
