<script setup lang="ts">
import type { ContactInfo } from '~/types/crm'

interface MessageHit {
  id: string
  conversationId: string
  direction: 'INBOUND' | 'OUTBOUND'
  body: string | null
  createdAt: string
  contact: { id: string; name: string | null; waId: string }
}

const api = useApi()
const router = useRouter()
const { shortDate } = useFormat()
const q = ref('')
const open = ref(false)
const loading = ref(false)
const results = ref<{ contacts: ContactInfo[]; messages: MessageHit[] } | null>(null)
const root = ref<HTMLElement | null>(null)

let debounce: ReturnType<typeof setTimeout> | undefined
watch(q, (value) => {
  clearTimeout(debounce)
  if (value.trim().length < 2) {
    results.value = null
    return
  }
  debounce = setTimeout(async () => {
    loading.value = true
    try {
      results.value = await api<{ contacts: ContactInfo[]; messages: MessageHit[] }>('/search', {
        query: { q: value.trim() },
      })
    } finally {
      loading.value = false
    }
  }, 250)
})

function onClickOutside(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false
}
onMounted(() => document.addEventListener('click', onClickOutside))
onBeforeUnmount(() => document.removeEventListener('click', onClickOutside))

/** Shows a window of text around the first match. */
function snippet(body: string | null) {
  if (!body) return ''
  return body.length > 110 ? `${body.slice(0, 110)}…` : body
}

function go(path: string) {
  open.value = false
  q.value = ''
  void router.push(path)
}
</script>

<template>
  <div ref="root" class="relative">
    <input
      v-model="q"
      type="search"
      class="input py-1.5 text-sm"
      :placeholder="$t('search.placeholder')"
      dir="auto"
      @focus="open = true"
      @keydown.escape="open = false"
    />
    <div
      v-if="open && q.trim()"
      class="card absolute inset-x-0 top-full z-30 mt-1 max-h-[70dvh] overflow-y-auto py-1 text-sm"
    >
      <p v-if="q.trim().length < 2" class="px-3 py-2 text-slate-500">{{ $t('search.minChars') }}</p>
      <p v-else-if="loading && !results" class="px-3 py-2 text-slate-500">
        {{ $t('common.loading') }}
      </p>
      <template v-else-if="results">
        <p
          v-if="!results.contacts.length && !results.messages.length"
          class="px-3 py-2 text-slate-500"
        >
          {{ $t('search.none', { q }) }}
        </p>
        <template v-if="results.contacts.length">
          <p class="px-3 pt-2 pb-1 text-xs font-semibold text-slate-500">
            {{ $t('search.contacts') }}
          </p>
          <button
            v-for="c in results.contacts"
            :key="c.id"
            type="button"
            class="flex w-full items-center gap-2 px-3 py-2 text-start hover:bg-slate-50 dark:hover:bg-slate-800"
            @click="go(`/contacts/${c.id}`)"
          >
            <span class="font-medium">{{ c.displayName ?? `+${c.waId}` }}</span>
            <span class="ltr text-xs text-slate-500">+{{ c.waId }}</span>
          </button>
        </template>
        <template v-if="results.messages.length">
          <p class="px-3 pt-2 pb-1 text-xs font-semibold text-slate-500">
            {{ $t('search.messages') }}
          </p>
          <button
            v-for="m in results.messages"
            :key="m.id"
            type="button"
            class="block w-full px-3 py-2 text-start hover:bg-slate-50 dark:hover:bg-slate-800"
            @click="go(`/inbox/${m.conversationId}`)"
          >
            <span class="flex justify-between gap-2 text-xs text-slate-500">
              <span>{{ m.contact.name ?? `+${m.contact.waId}` }}</span>
              <span>{{ shortDate(m.createdAt) }}</span>
            </span>
            <span class="line-clamp-2 block" dir="auto">{{ snippet(m.body) }}</span>
          </button>
        </template>
      </template>
    </div>
  </div>
</template>
