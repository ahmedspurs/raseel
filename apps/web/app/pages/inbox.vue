<script setup lang="ts">
import { SlidersHorizontal } from 'lucide-vue-next'
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
const statusDot: Record<string, string> = {
  OPEN: 'bg-active',
  PENDING: 'bg-warn',
  CLOSED: 'border border-slate-400',
}

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
      class="w-full shrink-0 flex-col border-e border-slate-200 bg-white md:flex md:w-[22rem] lg:w-96"
      :class="activeId ? 'hidden' : 'flex'"
    >
      <header class="space-y-3 px-5 pb-3 pt-5">
        <div class="flex items-center justify-between gap-2">
          <h1 class="text-xl font-bold">{{ $t('nav.inbox') }}</h1>
          <div class="flex items-center gap-3">
            <span
              v-if="!realtime.connected.value"
              class="flex items-center gap-1.5 text-xs text-slate-500"
              role="status"
            >
              <span class="dot animate-pulse bg-warn" aria-hidden="true" />{{
                $t('inbox.reconnecting')
              }}
            </span>
            <span
              v-else-if="inbox.connected !== null"
              class="flex items-center gap-1.5 text-xs text-slate-600"
            >
              <span
                class="dot"
                :class="inbox.connected ? 'bg-active' : 'bg-slate-400'"
                aria-hidden="true"
              />{{ inbox.connected ? $t('inbox.whatsappConnected') : $t('inbox.whatsappOff') }}
            </span>
            <button
              type="button"
              class="relative grid size-9 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              :class="{ 'bg-slate-100 text-slate-900': showFilters }"
              :title="$t('inbox.filters.title')"
              :aria-label="$t('inbox.filters.title')"
              :aria-expanded="showFilters"
              @click="showFilters = !showFilters"
            >
              <SlidersHorizontal class="size-[18px]" :stroke-width="1.5" aria-hidden="true" />
              <span
                v-if="inbox.activeFilterCount"
                class="num absolute end-1 top-1 grid size-4 place-items-center rounded-full bg-slate-900 text-[10px] text-white"
              >
                {{ inbox.activeFilterCount }}
              </span>
            </button>
          </div>
        </div>

        <GlobalSearch />

        <nav class="flex gap-0.5 rounded-[9px] bg-slate-100 p-[3px]" :aria-label="$t('nav.inbox')">
          <button
            v-for="v in views"
            :key="v"
            type="button"
            class="flex flex-1 items-center justify-center gap-1 rounded-[7px] px-1.5 py-1.5 text-[13px] whitespace-nowrap"
            :class="
              inbox.view === v
                ? 'bg-white font-semibold text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            "
            :aria-pressed="inbox.view === v"
            @click="inbox.view = v"
          >
            {{ $t(`inbox.views.${v}`) }}
            <span v-if="v !== 'closed' && inbox.counts[v]" class="num text-[11px] text-slate-500">
              {{ inbox.counts[v] }}
            </span>
          </button>
        </nav>

        <div
          v-if="showFilters"
          class="grid grid-cols-2 gap-x-3 gap-y-2.5 border-t border-slate-200 pt-3"
        >
          <label v-if="inbox.view !== 'closed'" class="col-span-2">
            <span class="label">{{ $t('inbox.filters.status') }}</span>
            <select v-model="inbox.filters.status" class="input">
              <option value="">{{ $t('inbox.filters.any') }}</option>
              <option value="OPEN">{{ $t('inbox.filters.OPEN') }}</option>
              <option value="PENDING">{{ $t('inbox.filters.PENDING') }}</option>
            </select>
          </label>
          <label>
            <span class="label">{{ $t('inbox.filters.agent') }}</span>
            <select v-model="inbox.filters.assigneeId" class="input">
              <option value="">{{ $t('inbox.filters.any') }}</option>
              <option v-for="u in directory.assignable" :key="u.id" :value="u.id">
                {{ u.name }}
              </option>
            </select>
          </label>
          <label>
            <span class="label">{{ $t('inbox.filters.team') }}</span>
            <select v-model="inbox.filters.teamId" class="input">
              <option value="">{{ $t('inbox.filters.any') }}</option>
              <option v-for="tm in directory.teams" :key="tm.id" :value="tm.id">
                {{ tm.name }}
              </option>
            </select>
          </label>
          <label class="col-span-2">
            <span class="label">{{ $t('inbox.filters.tag') }}</span>
            <select v-model="inbox.filters.tagId" class="input">
              <option value="">{{ $t('inbox.filters.any') }}</option>
              <option v-for="tg in tags" :key="tg.id" :value="tg.id">{{ tg.name }}</option>
            </select>
          </label>
          <label>
            <span class="label">{{ $t('inbox.filters.from') }}</span>
            <input v-model="inbox.filters.from" type="date" class="input ltr" />
          </label>
          <label>
            <span class="label">{{ $t('inbox.filters.to') }}</span>
            <input v-model="inbox.filters.to" type="date" class="input ltr" />
          </label>
          <button
            v-if="inbox.activeFilterCount"
            type="button"
            class="btn-ghost col-span-2 justify-start px-0"
            @click="inbox.clearFilters()"
          >
            {{ $t('inbox.filters.clear') }}
          </button>
        </div>
      </header>

      <div
        v-if="inbox.connected === false && auth.can('whatsapp:manage')"
        class="mx-5 mb-3 flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2.5 text-sm"
      >
        <span class="text-slate-600">{{ $t('inbox.notConnected') }}</span>
        <NuxtLink
          to="/settings/whatsapp"
          class="shrink-0 font-semibold text-slate-900 underline-offset-4 hover:underline"
        >
          {{ $t('inbox.connectNow') }}
        </NuxtLink>
      </div>

      <ul class="flex-1 overflow-y-auto border-t border-slate-200">
        <li
          v-if="inbox.loaded && !inbox.conversations.length"
          class="px-5 py-10 text-sm text-slate-500"
        >
          {{
            inbox.view === 'all' && !inbox.activeFilterCount
              ? $t('inbox.noConversations')
              : $t('inbox.emptyView')
          }}
        </li>
        <li v-for="c in inbox.conversations" :key="c.id">
          <NuxtLink
            :to="`/inbox/${c.id}`"
            class="flex gap-3 border-b border-slate-100 border-s-[3px] px-5 py-3.5"
            :class="
              c.id === activeId
                ? 'border-s-slate-900 bg-slate-100'
                : 'border-s-transparent hover:bg-slate-50'
            "
          >
            <span
              class="grid size-10 shrink-0 place-items-center rounded-full text-[13px] font-semibold"
              :class="c.unreadCount ? 'bg-brand-100 text-raseel' : 'bg-slate-100 text-slate-600'"
            >
              {{ initials(c.contact.name) }}
            </span>
            <span class="flex min-w-0 flex-1 flex-col gap-0.5">
              <span class="flex items-baseline justify-between gap-2">
                <span
                  class="truncate text-[15px]"
                  :class="c.unreadCount ? 'font-bold' : 'font-semibold'"
                >
                  {{ c.contact.name ?? `+${c.contact.waId}` }}
                </span>
                <span
                  class="num shrink-0 text-xs"
                  :class="c.unreadCount ? 'font-medium text-slate-900' : 'text-slate-500'"
                >
                  {{ shortDate(c.lastMessageAt) }}
                </span>
              </span>
              <span class="flex items-center justify-between gap-2">
                <span
                  class="truncate text-sm"
                  :class="c.unreadCount ? 'text-slate-900' : 'text-slate-600'"
                >
                  <PreviewText :text="c.lastMessagePreview" />
                </span>
                <span
                  v-if="c.unreadCount"
                  class="num grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-slate-900 px-1.5 text-[11px] font-semibold text-white"
                >
                  {{ c.unreadCount }}
                </span>
              </span>
              <span class="flex min-w-0 items-center gap-2.5 text-xs text-slate-500">
                <span class="flex items-center gap-1.5">
                  <span
                    class="dot box-border size-1.5"
                    :class="statusDot[c.status]"
                    aria-hidden="true"
                  />
                  {{ $t(`inbox.statusLabel.${c.status}`) }}
                </span>
                <span class="truncate">{{
                  c.assigneeId ? directory.userName(c.assigneeId) : $t('inbox.unassigned')
                }}</span>
                <span v-if="c.teamId" class="truncate">{{ directory.teamName(c.teamId) }}</span>
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
