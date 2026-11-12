<script setup lang="ts">
import { AtSign } from 'lucide-vue-next'

withDefaults(defineProps<{ variant?: 'rail' | 'light' }>(), { variant: 'light' })

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
      class="relative grid size-11 place-items-center rounded-xl"
      :class="
        variant === 'rail'
          ? 'text-slate-400 hover:bg-slate-800 hover:text-white'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
      "
      :title="$t('inbox.mentions')"
      :aria-label="$t('inbox.mentions')"
      :aria-expanded="open"
      @click="open = !open"
    >
      <AtSign class="size-5" :stroke-width="1.5" aria-hidden="true" />
      <span
        v-if="mentions.unread"
        class="num absolute end-1.5 top-1.5 grid min-w-4 place-items-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold text-slate-900"
      >
        {{ mentions.unread }}
      </span>
    </button>

    <div
      v-if="open"
      class="card absolute z-40 w-80 max-w-[calc(100vw-2rem)] overflow-hidden shadow-lg"
      :class="variant === 'rail' ? 'bottom-0 start-full ms-3' : 'end-0 top-full mt-2'"
    >
      <div class="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
        <span class="text-sm font-semibold">{{ $t('inbox.mentions') }}</span>
        <button
          v-if="mentions.unread"
          type="button"
          class="text-xs font-medium text-slate-600 hover:text-slate-900"
          @click="mentions.markRead()"
        >
          {{ $t('inbox.markAllRead') }}
        </button>
      </div>
      <p v-if="!mentions.items.length" class="px-4 py-6 text-center text-sm text-slate-500">
        {{ $t('inbox.noMentions') }}
      </p>
      <ul v-else class="max-h-96 divide-y divide-slate-100 overflow-y-auto">
        <li v-for="m in mentions.items" :key="m.noteId">
          <NuxtLink
            :to="`/inbox/${m.conversationId}`"
            class="block px-4 py-3 text-sm hover:bg-slate-50"
            @click="open = false"
          >
            <span class="flex justify-between gap-2 text-xs text-slate-500">
              <span class="flex items-center gap-1.5">
                <span v-if="!m.readAt" class="dot bg-amber-500" aria-hidden="true" />
                {{ $t('inbox.mentionedYou', { name: m.author?.name ?? '—' }) }} ·
                {{ m.contactName }}
              </span>
              <span class="num">{{ shortDate(m.createdAt) }}</span>
            </span>
            <span class="mt-1 line-clamp-2 block text-slate-800" dir="auto">{{
              render(m.body)
            }}</span>
          </NuxtLink>
        </li>
      </ul>
    </div>
  </div>
</template>
