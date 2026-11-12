<script setup lang="ts">
const mentions = useMentionsStore()
const realtime = useRealtime()
const { shortDate } = useFormat()
const directory = useDirectoryStore()
const open = ref(false)
const root = ref<HTMLElement | null>(null)

realtime.on('mention', () => void mentions.refresh())
onMounted(() => void mentions.refresh())

function onClickOutside(e: MouseEvent) {
  if (open.value && root.value && !root.value.contains(e.target as Node)) open.value = false
}
onMounted(() => document.addEventListener('click', onClickOutside))
onBeforeUnmount(() => document.removeEventListener('click', onClickOutside))

/** Replaces <@id> tokens with @Name for display. */
const render = (body: string) =>
  body.replace(/<@([a-z0-9]+)>/gi, (_, id: string) => `@${directory.userName(id) ?? '…'}`)
</script>

<template>
  <div ref="root" class="relative">
    <button
      type="button"
      class="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
      :aria-label="$t('inbox.mentions')"
      :aria-expanded="open"
      @click="open = !open"
    >
      <svg
        viewBox="0 0 24 24"
        class="size-5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0" />
      </svg>
      <span
        v-if="mentions.unread"
        class="absolute -end-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white"
      >
        {{ mentions.unread }}
      </span>
    </button>

    <div
      v-if="open"
      class="card absolute bottom-full start-0 z-30 mb-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden md:bottom-auto md:top-full md:mb-0 md:mt-2"
    >
      <div
        class="flex items-center justify-between border-b border-slate-200 px-4 py-2.5 dark:border-slate-800"
      >
        <span class="font-semibold">{{ $t('inbox.mentions') }}</span>
        <button
          v-if="mentions.unread"
          type="button"
          class="text-xs font-medium text-brand-700"
          @click="mentions.markRead()"
        >
          {{ $t('inbox.markAllRead') }}
        </button>
      </div>
      <p v-if="!mentions.items.length" class="p-4 text-center text-sm text-slate-500">
        {{ $t('inbox.noMentions') }}
      </p>
      <ul v-else class="max-h-96 overflow-y-auto">
        <li v-for="m in mentions.items" :key="m.noteId">
          <NuxtLink
            :to="`/inbox/${m.conversationId}`"
            class="block border-b border-slate-100 px-4 py-3 text-sm hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800"
            :class="{ 'bg-brand-50/60 dark:bg-brand-900/20': !m.readAt }"
            @click="open = false"
          >
            <span class="flex justify-between gap-2 text-xs text-slate-500">
              <span
                >{{ $t('inbox.mentionedYou', { name: m.author?.name ?? '—' }) }} ·
                {{ m.contactName }}</span
              >
              <span>{{ shortDate(m.createdAt) }}</span>
            </span>
            <span class="mt-1 line-clamp-2 block" dir="auto">{{ render(m.body) }}</span>
          </NuxtLink>
        </li>
      </ul>
    </div>
  </div>
</template>
