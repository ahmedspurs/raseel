<script setup lang="ts">
import type { InboxFilter } from '~/stores/inbox'

const { t } = useI18n()
useHead({ title: () => t('nav.inbox') })

const inbox = useInboxStore()
const auth = useAuthStore()
const route = useRoute()
const { shortDate } = useFormat()

const activeId = computed(() => (route.params.id as string | undefined) ?? null)
const filters: InboxFilter[] = ['OPEN', 'PENDING', 'CLOSED', 'ALL']

// Phase 2 refreshes by polling; realtime push replaces this in the team inbox.
let timer: ReturnType<typeof setInterval> | undefined
onMounted(async () => {
  await Promise.all([inbox.refresh(), inbox.checkConnection()])
  timer = setInterval(() => void inbox.refresh(), 5000)
})
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <div class="flex h-[calc(100dvh-4.5rem)] md:h-dvh">
    <section
      class="w-full shrink-0 flex-col border-e border-slate-200 bg-white md:flex md:w-80 lg:w-96 dark:border-slate-800 dark:bg-slate-900"
      :class="activeId ? 'hidden' : 'flex'"
    >
      <header class="space-y-3 border-b border-slate-200 p-4 dark:border-slate-800">
        <h1 class="text-lg font-bold">{{ $t('nav.inbox') }}</h1>
        <div class="flex gap-1 overflow-x-auto">
          <button
            v-for="f in filters"
            :key="f"
            type="button"
            class="rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap"
            :class="
              inbox.filter === f
                ? 'bg-brand-700 text-white'
                : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
            "
            @click="inbox.filter = f"
          >
            {{ $t(`inbox.filters.${f}`) }}
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
