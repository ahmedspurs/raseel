<script setup lang="ts">
import { Lock } from 'lucide-vue-next'
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
  <!-- Internal notes: dashed amber, a lock, centred — never mistaken for a customer message. -->
  <div class="flex justify-center py-1">
    <div
      class="flex w-full max-w-xl gap-2.5 rounded-xl border border-dashed border-amber-300 bg-amber-50/70 px-3.5 py-2.5 text-amber-950"
    >
      <Lock class="mt-1 size-4 shrink-0 text-amber-700" :stroke-width="1.5" aria-hidden="true" />
      <div class="min-w-0 flex-1">
        <p class="flex items-baseline justify-between gap-2 text-xs text-amber-800">
          <span class="font-semibold"
            >{{ $t('inbox.noteBadge') }} · {{ note.author?.name ?? '—' }}</span
          >
          <time class="num" :datetime="note.createdAt">{{
            time.format(new Date(note.createdAt))
          }}</time>
        </p>
        <p class="mt-0.5 whitespace-pre-wrap break-words text-sm leading-6" dir="auto">
          <template v-for="(p, i) in parts" :key="i">
            <span
              v-if="p.mention"
              class="font-semibold"
              :class="p.mention === auth.user?.id ? 'rounded bg-amber-200 px-0.5' : ''"
              >{{ p.text }}</span
            >
            <template v-else>{{ p.text }}</template>
          </template>
        </p>
      </div>
    </div>
  </div>
</template>
