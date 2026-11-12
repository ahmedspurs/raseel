<script setup lang="ts">
import type { QuickReply } from '~/stores/directory'

definePageMeta({
  middleware: [
    () => (useAuthStore().can('templates:manage') ? undefined : navigateTo('/settings')),
  ],
})

const api = useApi()
const toMessage = useApiError()
const directory = useDirectoryStore()

const { data: replies, refresh } = await useAsyncData('quick-replies', () =>
  api<{ quickReplies: QuickReply[] }>('/quick-replies').then((r) => r.quickReplies),
)

type Draft = {
  id: string | null
  shortcut: string
  title: string
  body: string
  language: '' | 'ar' | 'en'
}
const editing = ref<Draft | null>(null)
const busy = ref(false)
const error = ref<string | null>(null)

function startNew() {
  editing.value = { id: null, shortcut: '', title: '', body: '', language: '' }
}
function startEdit(q: QuickReply) {
  editing.value = { ...q, language: q.language ?? '' }
}

async function save() {
  if (!editing.value) return
  busy.value = true
  error.value = null
  const { id, ...rest } = editing.value
  try {
    await api(id ? `/quick-replies/${id}` : '/quick-replies', {
      method: id ? 'PUT' : 'POST',
      body: { ...rest, language: rest.language || null },
    })
    editing.value = null
    await Promise.all([refresh(), directory.load(true)])
  } catch (err) {
    error.value = toMessage(err)
  } finally {
    busy.value = false
  }
}

async function remove(id: string) {
  await api(`/quick-replies/${id}`, { method: 'DELETE' })
  await Promise.all([refresh(), directory.load(true)])
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="text-lg font-semibold">{{ $t('quickReplies.title') }}</h2>
        <p class="text-sm text-slate-600 dark:text-slate-400">{{ $t('quickReplies.intro') }}</p>
      </div>
      <button type="button" class="btn-primary" @click="startNew">
        {{ $t('quickReplies.new') }}
      </button>
    </div>

    <form v-if="editing" class="card space-y-4 p-6" @submit.prevent="save">
      <div class="grid gap-4 sm:grid-cols-3">
        <div>
          <label class="label" for="qr-shortcut">{{ $t('quickReplies.shortcut') }}</label>
          <div class="flex items-center gap-1">
            <span class="text-slate-500">/</span>
            <input
              id="qr-shortcut"
              v-model="editing.shortcut"
              class="input"
              required
              maxlength="32"
              dir="auto"
            />
          </div>
          <p class="mt-1 text-xs text-slate-500" dir="auto">
            {{ $t('quickReplies.shortcutHint', { shortcut: editing.shortcut || '…' }) }}
          </p>
        </div>
        <div>
          <label class="label" for="qr-title">{{ $t('quickReplies.titleLabel') }}</label>
          <input
            id="qr-title"
            v-model="editing.title"
            class="input"
            required
            maxlength="80"
            dir="auto"
          />
        </div>
        <div>
          <label class="label" for="qr-lang">{{ $t('quickReplies.language') }}</label>
          <select id="qr-lang" v-model="editing.language" class="input">
            <option value="">{{ $t('quickReplies.anyLanguage') }}</option>
            <option value="ar">العربية</option>
            <option value="en">English</option>
          </select>
        </div>
      </div>
      <div>
        <label class="label" for="qr-body">{{ $t('quickReplies.body') }}</label>
        <textarea
          id="qr-body"
          v-model="editing.body"
          class="input min-h-28"
          required
          maxlength="4096"
          dir="auto"
        />
      </div>
      <FormAlert :message="error" />
      <div class="flex gap-3">
        <button type="button" class="btn-secondary" @click="editing = null">
          {{ $t('common.cancel') }}
        </button>
        <button type="submit" class="btn-primary" :disabled="busy">{{ $t('common.save') }}</button>
      </div>
    </form>

    <p v-if="!replies?.length && !editing" class="card p-6 text-center text-sm text-slate-500">
      {{ $t('quickReplies.empty') }}
    </p>
    <ul v-else class="card divide-y divide-slate-100 dark:divide-slate-800">
      <li v-for="q in replies" :key="q.id" class="flex items-start gap-4 p-4">
        <div class="min-w-0 flex-1">
          <p class="flex flex-wrap items-center gap-2">
            <code
              class="rounded bg-slate-100 px-1.5 py-0.5 text-sm font-semibold dark:bg-slate-800"
              dir="auto"
              >/{{ q.shortcut }}</code
            >
            <span class="font-medium" dir="auto">{{ q.title }}</span>
            <span v-if="q.language" class="badge bg-slate-100 text-slate-600">{{
              q.language.toUpperCase()
            }}</span>
          </p>
          <p
            class="mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-400"
            dir="auto"
          >
            {{ q.body }}
          </p>
        </div>
        <div class="flex shrink-0 gap-3 text-sm">
          <button type="button" class="font-medium text-brand-700" @click="startEdit(q)">
            {{ $t('common.edit') }}
          </button>
          <button type="button" class="font-medium text-rose-600" @click="remove(q.id)">
            {{ $t('common.delete') }}
          </button>
        </div>
      </li>
    </ul>
  </div>
</template>
