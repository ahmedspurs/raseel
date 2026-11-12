<script setup lang="ts">
import type { InboxNote } from '~/types/inbox'

const props = defineProps<{ note: InboxNote }>()
const directory = useDirectoryStore()
const auth = useAuthStore()
const { time } = useFormat()

/** Splits the body into text and mention parts so mentions render as highlighted names. */
const parts = computed(() => {
  const out: { text: string; mention?: string }[] = []
  let last = 0
  for (const m of props.note.body.matchAll(/<@([a-z0-9]+)>/gi)) {
    if (m.index! > last) out.push({ text: props.note.body.slice(last, m.index) })
    const id = m[1]!
    out.push({ text: `@${directory.userName(id) ?? '…'}`, mention: id })
    last = m.index! + m[0].length
  }
  if (last < props.note.body.length) out.push({ text: props.note.body.slice(last) })
  return out
})
</script>

<template>
  <div class="flex justify-center">
    <div
      class="w-full max-w-xl rounded-2xl border border-amber-200 bg-amber-50 px-3.5 py-2 text-amber-950 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-50"
    >
      <p
        class="mb-0.5 flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-200"
      >
        <svg
          viewBox="0 0 24 24"
          class="size-3.5"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          aria-hidden="true"
        >
          <rect x="5" y="11" width="14" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
        {{ $t('inbox.noteBadge') }} · {{ note.author?.name ?? '—' }}
      </p>
      <p class="whitespace-pre-wrap break-words" dir="auto">
        <template v-for="(p, i) in parts" :key="i">
          <span
            v-if="p.mention"
            class="rounded px-0.5 font-semibold"
            :class="
              p.mention === auth.user?.id
                ? 'bg-amber-300 text-amber-950'
                : 'text-amber-800 dark:text-amber-200'
            "
            >{{ p.text }}</span
          >
          <template v-else>{{ p.text }}</template>
        </template>
      </p>
      <p class="mt-1 text-end text-[11px] text-amber-700/80 dark:text-amber-300/80">
        <time :datetime="note.createdAt">{{ time.format(new Date(note.createdAt)) }}</time>
      </p>
    </div>
  </div>
</template>
