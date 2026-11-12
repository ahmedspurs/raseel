<script setup lang="ts">
import type { ContactInfo, TagInfo } from '~/types/crm'

const { t } = useI18n()
useHead({ title: () => t('contacts.title') })

const api = useApi()
const toMessage = useApiError()
const auth = useAuthStore()
const { shortDate } = useFormat()

const q = ref('')
const tagId = ref('')
const optIn = ref<'' | 'true' | 'false'>('')
const contacts = ref<ContactInfo[]>([])
const total = ref(0)
const nextCursor = ref<string | null>(null)
const loading = ref(false)

const { data: tags } = await useAsyncData('contact-tags', () =>
  api<{ tags: TagInfo[] }>('/tags').then((r) => r.tags),
)

async function load(more = false) {
  loading.value = true
  try {
    const res = await api<{ contacts: ContactInfo[]; total: number; nextCursor: string | null }>(
      '/contacts',
      {
        query: {
          q: q.value || undefined,
          tagId: tagId.value || undefined,
          optIn: optIn.value || undefined,
          cursor: more ? (nextCursor.value ?? undefined) : undefined,
        },
      },
    )
    contacts.value = more ? [...contacts.value, ...res.contacts] : res.contacts
    total.value = res.total
    nextCursor.value = res.nextCursor
  } finally {
    loading.value = false
  }
}

let debounce: ReturnType<typeof setTimeout> | undefined
watch(q, () => {
  clearTimeout(debounce)
  debounce = setTimeout(() => void load(), 300)
})
watch([tagId, optIn], () => void load())
onMounted(() => void load())

// ── CSV import (FR-32) ──
const importing = ref(false)
const importResult = ref<{
  created: number
  updated: number
  optedIn: number
  errors: { row: number; error: string }[]
} | null>(null)
const importError = ref<string | null>(null)
async function importCsv(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  importResult.value = null
  importError.value = null
  const form = new FormData()
  form.append('file', file, file.name)
  try {
    importResult.value = await api('/contacts/import', { method: 'POST', body: form })
    await load()
  } catch (err) {
    importError.value = toMessage(err)
  }
}

// ── Add contact ──
const adding = ref(false)
const newContact = reactive({ waId: '', name: '' })
const addError = ref<string | null>(null)
const existingId = ref<string | null>(null)

async function addContact() {
  addError.value = null
  existingId.value = null
  try {
    const res = await api<{ contact: ContactInfo }>('/contacts', {
      method: 'POST',
      body: newContact,
    })
    await navigateTo(`/contacts/${res.contact.id}`)
  } catch (err) {
    addError.value = toMessage(err)
    existingId.value = (err as { data?: { contactId?: string } }).data?.contactId ?? null
  }
}
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-10">
    <div class="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold">{{ $t('contacts.title') }}</h1>
        <p class="text-sm text-slate-500">{{ $t('contacts.total', { n: total }) }}</p>
      </div>
      <div class="flex flex-wrap gap-2">
        <a
          v-if="auth.can('data:export')"
          href="/api/contacts/export.csv"
          class="btn-secondary"
          download
        >
          {{ $t('csv.export') }}
        </a>
        <button
          v-if="auth.can('settings:manage')"
          type="button"
          class="btn-secondary"
          @click="importing = !importing"
        >
          {{ $t('csv.import') }}
        </button>
        <button
          v-if="auth.can('contacts:edit')"
          type="button"
          class="btn-primary"
          @click="adding = !adding"
        >
          {{ $t('contacts.add') }}
        </button>
      </div>
    </div>

    <div v-if="importing" class="card mb-5 space-y-3 p-5">
      <p class="text-sm text-slate-600 dark:text-slate-400">{{ $t('csv.importHelp') }}</p>
      <input type="file" accept=".csv,text/csv" class="text-sm" @change="importCsv" />
      <FormAlert
        v-if="importResult"
        tone="success"
        :message="$t('csv.importResult', importResult)"
      />
      <FormAlert :message="importError" />
      <details v-if="importResult?.errors.length" class="text-sm">
        <summary class="cursor-pointer font-medium">
          {{ $t('csv.errorsTitle') }} ({{ importResult.errors.length }})
        </summary>
        <ul class="mt-2 space-y-1 text-xs text-rose-700">
          <li v-for="e in importResult.errors" :key="e.row">
            {{ $t('csv.row', { row: e.row, error: $t(`errors.${e.error}`) }) }}
          </li>
        </ul>
      </details>
    </div>

    <form
      v-if="adding"
      class="card mb-5 grid gap-4 p-5 sm:grid-cols-3"
      @submit.prevent="addContact"
    >
      <div>
        <label class="label" for="nc-phone">{{ $t('contacts.phone') }}</label>
        <input id="nc-phone" v-model="newContact.waId" class="input ltr" required inputmode="tel" />
        <p class="mt-1 text-xs text-slate-500">{{ $t('contacts.phoneHint') }}</p>
      </div>
      <div>
        <label class="label" for="nc-name">{{ $t('common.name') }}</label>
        <input id="nc-name" v-model="newContact.name" class="input" maxlength="120" />
      </div>
      <div class="flex items-end gap-2">
        <button type="submit" class="btn-primary">{{ $t('common.create') }}</button>
        <button type="button" class="btn-secondary" @click="adding = false">
          {{ $t('common.cancel') }}
        </button>
      </div>
      <div v-if="addError" class="sm:col-span-3">
        <FormAlert :message="addError" />
        <NuxtLink
          v-if="existingId"
          :to="`/contacts/${existingId}`"
          class="mt-2 inline-block text-sm font-semibold text-brand-700"
        >
          {{ $t('contacts.openExisting') }}
        </NuxtLink>
      </div>
    </form>

    <div class="mb-4 flex flex-wrap gap-2">
      <input
        v-model="q"
        type="search"
        class="input min-w-56 flex-1"
        :placeholder="$t('contacts.search')"
        dir="auto"
      />
      <select v-model="tagId" class="input w-auto">
        <option value="">{{ $t('contacts.allTags') }}</option>
        <option v-for="tg in tags" :key="tg.id" :value="tg.id">{{ tg.name }}</option>
      </select>
      <select v-model="optIn" class="input w-auto">
        <option value="">{{ $t('contacts.anyConsent') }}</option>
        <option value="true">{{ $t('contacts.optedIn') }}</option>
        <option value="false">{{ $t('contacts.notOptedIn') }}</option>
      </select>
    </div>

    <div class="card overflow-x-auto">
      <table class="w-full text-sm">
        <thead class="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-800">
          <tr>
            <th class="px-4 py-3 text-start font-medium">{{ $t('common.name') }}</th>
            <th class="px-4 py-3 text-start font-medium">{{ $t('contacts.company') }}</th>
            <th class="px-4 py-3 text-start font-medium">{{ $t('contacts.tags') }}</th>
            <th class="px-4 py-3 text-start font-medium">{{ $t('contacts.optIn') }}</th>
            <th class="px-4 py-3 text-start font-medium"></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
          <tr v-if="!loading && !contacts.length">
            <td colspan="5" class="px-4 py-8 text-center text-slate-500">
              {{ $t('contacts.empty') }}
            </td>
          </tr>
          <tr
            v-for="c in contacts"
            :key="c.id"
            class="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/60"
            @click="navigateTo(`/contacts/${c.id}`)"
          >
            <td class="px-4 py-3">
              <div class="flex items-center gap-3">
                <span
                  class="grid size-9 shrink-0 place-items-center rounded-full bg-slate-200 text-xs font-semibold dark:bg-slate-700"
                >
                  {{ initials(c.displayName) }}
                </span>
                <span class="min-w-0">
                  <span class="block truncate font-medium">{{
                    c.displayName ?? `+${c.waId}`
                  }}</span>
                  <span class="ltr block text-xs text-slate-500">+{{ c.waId }}</span>
                </span>
              </div>
            </td>
            <td class="px-4 py-3 text-slate-600 dark:text-slate-400">{{ c.company ?? '—' }}</td>
            <td class="px-4 py-3">
              <span class="flex flex-wrap gap-1">
                <span
                  v-for="tg in c.tags"
                  :key="tg.id"
                  class="badge text-white"
                  :style="{ backgroundColor: tg.color }"
                  >{{ tg.name }}</span
                >
              </span>
            </td>
            <td class="px-4 py-3">
              <span v-if="c.optInMarketing" class="badge bg-emerald-100 text-emerald-800">{{
                $t('contacts.optedIn')
              }}</span>
              <span v-else class="text-slate-400">—</span>
            </td>
            <td class="px-4 py-3 text-end text-xs text-slate-500">{{ shortDate(c.createdAt) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="nextCursor" class="mt-4 flex justify-center">
      <button type="button" class="btn-secondary" :disabled="loading" @click="load(true)">
        {{ $t('common.loadMore') }}
      </button>
    </div>
  </div>
</template>
