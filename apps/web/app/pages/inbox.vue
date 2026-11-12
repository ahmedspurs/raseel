<script setup lang="ts">
import type { InboxView } from '@raseel/shared'
import type { ConversationSummary } from '~/types/inbox'

const { t } = useI18n()
useHead({ title: () => t('nav.inbox') })

const inbox = useInboxStore()
const directory = useDirectoryStore()
const auth = useAuthStore()
const realtime = useRealtime()
const route = useRoute()
const { shortDate } = useFormat()

const activeId = computed(() => (route.params.id as string | undefined) ?? null)
const views: InboxView[] = ['mine', 'unassigned', 'team', 'all', 'closed']
const showFilters = ref(false)
const tags = ref<{ id: string; name: string }[]>([])
watch(showFilters, async (open) => {
  if (open && !tags.value.length) {
    tags.value = (await useApi()<{ tags: { id: string; name: string }[] }>('/tags')).tags
  }
})

realtime.on<{ conversation: ConversationSummary }>('conversation', ({ conversation }) =>
  inbox.applyConversation(conversation),
)
// After a reconnect, events may have been missed: resync.
realtime.on('connect', () => void inbox.refresh())

// Safety net if the realtime connection is down.
let fallback: ReturnType<typeof setInterval> | undefined
onMounted(async () => {
  await Promise.all([inbox.refresh(), inbox.checkConnection(), directory.load()])
  fallback = setInterval(() => {
    if (!realtime.connected.value) void inbox.refresh()
  }, 15_000)
})
onBeforeUnmount(() => clearInterval(fallback))
</script>

<template>
  <div class="flex h-[calc(100dvh-4.5rem)] md:h-dvh">
    <section
      class="w-full shrink-0 flex-col border-e border-slate-200 bg-white md:flex md:w-80 lg:w-96 dark:border-slate-800 dark:bg-slate-900"
      :class="activeId ? 'hidden' : 'flex'"
    >
      <header class="space-y-3 border-b border-slate-200 p-4 dark:border-slate-800">
        <div class="flex items-center justify-between gap-2">
          <h1 class="text-lg font-bold">{{ $t('nav.inbox') }}</h1>
          <div class="flex items-center gap-1">
            <span
              v-if="!realtime.connected.value"
              class="badge bg-amber-100 text-amber-800"
              :title="$t('inbox.reconnecting')"
            >
              {{ $t('inbox.reconnecting') }}
            </span>
            <button
              type="button"
              class="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              :class="{ 'bg-slate-100 dark:bg-slate-800': showFilters }"
              :aria-label="$t('inbox.filters.title')"
              :aria-expanded="showFilters"
              @click="showFilters = !showFilters"
            >
              <svg
                viewBox="0 0 24 24"
                class="size-5"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
              >
                <path d="M4 6h16M7 12h10M10 18h4" />
              </svg>
              <span
                v-if="inbox.activeFilterCount"
                class="absolute -end-0.5 -top-0.5 grid size-4 place-items-center rounded-full bg-brand-600 text-[10px] font-bold text-white"
              >
                {{ inbox.activeFilterCount }}
              </span>
            </button>
          </div>
        </div>

        <GlobalSearch />

        <nav class="-mx-1 flex gap-1 overflow-x-auto px-1" :aria-label="$t('nav.inbox')">
          <button
            v-for="v in views"
            :key="v"
            type="button"
            class="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium whitespace-nowrap"
            :class="
              inbox.view === v
                ? 'bg-brand-700 text-white'
                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
            "
            @click="inbox.view = v"
          >
            {{ $t(`inbox.views.${v}`) }}
            <span
              v-if="v !== 'closed' && inbox.counts[v]"
              class="rounded-full px-1.5 text-xs"
              :class="inbox.view === v ? 'bg-white/20' : 'bg-slate-200 dark:bg-slate-700'"
            >
              {{ inbox.counts[v] }}
            </span>
          </button>
        </nav>

        <div v-if="showFilters" class="grid grid-cols-2 gap-2 text-sm">
          <label v-if="inbox.view !== 'closed'" class="col-span-2">
            <span class="label text-xs">{{ $t('inbox.filters.status') }}</span>
            <select v-model="inbox.filters.status" class="input py-1.5">
              <option value="">{{ $t('inbox.filters.any') }}</option>
              <option value="OPEN">{{ $t('inbox.filters.OPEN') }}</option>
              <option value="PENDING">{{ $t('inbox.filters.PENDING') }}</option>
            </select>
          </label>
          <label>
            <span class="label text-xs">{{ $t('inbox.filters.agent') }}</span>
            <select v-model="inbox.filters.assigneeId" class="input py-1.5">
              <option value="">{{ $t('inbox.filters.any') }}</option>
              <option v-for="u in directory.assignable" :key="u.id" :value="u.id">
                {{ u.name }}
              </option>
            </select>
          </label>
          <label>
            <span class="label text-xs">{{ $t('inbox.filters.team') }}</span>
            <select v-model="inbox.filters.teamId" class="input py-1.5">
              <option value="">{{ $t('inbox.filters.any') }}</option>
              <option v-for="tm in directory.teams" :key="tm.id" :value="tm.id">
                {{ tm.name }}
              </option>
            </select>
          </label>
          <label class="col-span-2">
            <span class="label text-xs">{{ $t('inbox.filters.tag') }}</span>
            <select v-model="inbox.filters.tagId" class="input py-1.5">
              <option value="">{{ $t('inbox.filters.any') }}</option>
              <option v-for="tg in tags" :key="tg.id" :value="tg.id">{{ tg.name }}</option>
            </select>
          </label>
          <label>
            <span class="label text-xs">{{ $t('inbox.filters.from') }}</span>
            <input v-model="inbox.filters.from" type="date" class="input ltr py-1.5" />
          </label>
          <label>
            <span class="label text-xs">{{ $t('inbox.filters.to') }}</span>
            <input v-model="inbox.filters.to" type="date" class="input ltr py-1.5" />
          </label>
          <button
            v-if="inbox.activeFilterCount"
            type="button"
            class="col-span-2 text-start text-sm font-medium text-brand-700"
            @click="inbox.clearFilters()"
          >
            {{ $t('inbox.filters.clear') }}
          </button>
        </div>
      </header>

      <div
        v-if="inbox.connected === false"
        class="m-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
      >
        {{ $t('inbox.notConnected') }}
        <NuxtLink
          v-if="auth.can('whatsapp:manage')"
          to="/settings/whatsapp"
          class="mt-1 block font-semibold underline"
        >
          {{ $t('inbox.connectNow') }}
        </NuxtLink>
      </div>

      <ul class="flex-1 overflow-y-auto">
        <li
          v-if="inbox.loaded && !inbox.conversations.length"
          class="p-6 text-center text-sm text-slate-500"
        >
          {{ $t('inbox.noConversations') }}
        </li>
        <li v-for="c in inbox.conversations" :key="c.id">
          <NuxtLink
            :to="`/inbox/${c.id}`"
            class="flex gap-3 border-b border-slate-100 px-4 py-3 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60"
            :class="{ 'bg-brand-50 dark:bg-brand-900/30': c.id === activeId }"
          >
            <span
              class="grid size-10 shrink-0 place-items-center rounded-full bg-slate-200 text-sm font-semibold text-slate-700 dark:bg-slate-700 dark:text-slate-100"
            >
              {{ initials(c.contact.name) }}
            </span>
            <span class="min-w-0 flex-1">
              <span class="flex items-baseline justify-between gap-2">
                <span class="truncate font-medium" :class="{ 'font-bold': c.unreadCount }">
                  {{ c.contact.name ?? `+${c.contact.waId}` }}
                </span>
                <span class="shrink-0 text-xs text-slate-500">{{
                  shortDate(c.lastMessageAt)
                }}</span>
              </span>
              <span class="mt-0.5 flex items-center justify-between gap-2">
                <span class="truncate text-sm text-slate-600 dark:text-slate-400" dir="auto">
                  {{ c.lastMessagePreview }}
                </span>
                <span
                  v-if="c.unreadCount"
                  class="grid min-w-5 shrink-0 place-items-center rounded-full bg-brand-600 px-1.5 text-xs font-bold text-white"
                >
                  {{ c.unreadCount }}
                </span>
              </span>
              <span class="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                <span
                  v-if="c.status === 'PENDING'"
                  class="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800"
                >
                  {{ $t('inbox.statusLabel.PENDING') }}
                </span>
                <span v-if="c.assigneeId" class="truncate">
                  👤 {{ directory.userName(c.assigneeId) }}
                </span>
                <span v-else class="italic">{{ $t('inbox.unassigned') }}</span>
                <span v-if="c.teamId" class="truncate">· {{ directory.teamName(c.teamId) }}</span>
              </span>
            </span>
          </NuxtLink>
        </li>
      </ul>
    </section>

    <section class="min-w-0 flex-1" :class="activeId ? 'flex' : 'hidden md:flex'">
      <NuxtPage />
    </section>
  </div>
</template>
