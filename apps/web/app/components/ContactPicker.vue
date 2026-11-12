<script setup lang="ts">
import type { ContactInfo } from '~/types/crm'

const model = defineModel<string>({ required: true })
defineProps<{ id?: string }>()

const api = useApi()
const q = ref('')
const options = ref<ContactInfo[]>([])
const selectedLabel = ref('')

let debounce: ReturnType<typeof setTimeout> | undefined
watch(q, (value) => {
  clearTimeout(debounce)
  debounce = setTimeout(async () => {
    const res = await api<{ contacts: ContactInfo[] }>('/contacts', {
      query: { q: value || undefined, limit: 8 },
    })
    options.value = res.contacts
  }, 250)
})
onMounted(() => (q.value = ''))

function choose(c: ContactInfo) {
  model.value = c.id
  selectedLabel.value = `${c.displayName ?? ''} +${c.waId}`.trim()
  options.value = []
  q.value = ''
}
</script>

<template>
  <div class="relative">
    <div v-if="model && selectedLabel" class="input flex items-center justify-between">
      <span dir="auto">{{ selectedLabel }}</span>
      <button
        type="button"
        class="text-slate-500"
        :aria-label="$t('common.cancel')"
        @click="model = ''"
      >
        ✕
      </button>
    </div>
    <template v-else>
      <input
        :id="id"
        v-model="q"
        class="input"
        :placeholder="$t('deals.searchContact')"
        dir="auto"
        autocomplete="off"
      />
      <ul
        v-if="options.length"
        class="card absolute inset-x-0 top-full z-20 mt-1 max-h-60 overflow-y-auto py-1 text-sm"
      >
        <li v-for="c in options" :key="c.id">
          <button
            type="button"
            class="flex w-full justify-between gap-2 px-3 py-2 text-start hover:bg-slate-50 dark:hover:bg-slate-800"
            @click="choose(c)"
          >
            <span dir="auto">{{ c.displayName ?? '—' }}</span>
            <span class="ltr text-xs text-slate-500">+{{ c.waId }}</span>
          </button>
        </li>
      </ul>
    </template>
  </div>
</template>
