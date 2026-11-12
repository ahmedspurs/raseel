<script setup lang="ts">
import type { TemplateInfo } from '~/types/crm'

definePageMeta({
  middleware: [
    () => (useAuthStore().can('templates:manage') ? undefined : navigateTo('/settings')),
  ],
})

const api = useApi()
const toMessage = useApiError()
const { t } = useI18n()

const { data: templates, refresh } = await useAsyncData('templates', () =>
  api<{ templates: TemplateInfo[] }>('/templates').then((r) => r.templates),
)

const syncing = ref(false)
const message = ref<{ text: string; tone: 'error' | 'success' } | null>(null)

async function sync() {
  syncing.value = true
  message.value = null
  try {
    const res = await api<{ total: number; approved: number }>('/templates/sync', {
      method: 'POST',
    })
    await refresh()
    message.value = { text: t('templates.synced', res), tone: 'success' }
  } catch (err) {
    message.value = { text: toMessage(err), tone: 'error' }
  } finally {
    syncing.value = false
  }
}

// ── Create ──
const creating = ref(false)
const draft = reactive({
  name: '',
  language: 'ar',
  category: 'UTILITY' as 'MARKETING' | 'UTILITY',
  header: '',
  body: '',
  examples: [] as string[],
  footer: '',
  buttons: [] as string[],
})
const varCount = computed(() =>
  Math.max(0, ...[...draft.body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1]))),
)
watch(varCount, (n) => {
  draft.examples = Array.from({ length: n }, (_, i) => draft.examples[i] ?? '')
})
const createBusy = ref(false)
const createError = ref<string | null>(null)

async function create() {
  createBusy.value = true
  createError.value = null
  try {
    await api('/templates', {
      method: 'POST',
      body: {
        name: draft.name,
        language: draft.language,
        category: draft.category,
        header: draft.header ? { text: draft.header } : undefined,
        body: draft.body,
        bodyExamples: draft.examples,
        footer: draft.footer || undefined,
        buttons: draft.buttons.filter(Boolean).map((text) => ({ type: 'QUICK_REPLY', text })),
      },
    })
    creating.value = false
    Object.assign(draft, { name: '', header: '', body: '', examples: [], footer: '', buttons: [] })
    await refresh()
  } catch (err) {
    const detail = (err as { data?: { detail?: { message?: string } } }).data?.detail?.message
    createError.value = detail ? `${toMessage(err)} ${detail}` : toMessage(err)
  } finally {
    createBusy.value = false
  }
}

async function remove(id: string) {
  try {
    await api(`/templates/${id}`, { method: 'DELETE' })
    await refresh()
  } catch (err) {
    message.value = { text: toMessage(err), tone: 'error' }
  }
}

const statusClass = (s: string) =>
  s === 'APPROVED'
    ? 'bg-emerald-100 text-emerald-800'
    : s === 'REJECTED' || s === 'DISABLED'
      ? 'bg-rose-100 text-rose-800'
      : 'bg-amber-100 text-amber-800'
const bodyOf = (tpl: TemplateInfo) => tpl.components.find((c) => c.type === 'BODY')?.text ?? ''
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="text-lg font-semibold">{{ $t('templates.title') }}</h2>
        <p class="text-sm text-slate-600 dark:text-slate-400">{{ $t('templates.intro') }}</p>
      </div>
      <div class="flex gap-2">
        <button type="button" class="btn-secondary" :disabled="syncing" @click="sync">
          {{ $t('templates.sync') }}
        </button>
        <button type="button" class="btn-primary" @click="creating = !creating">
          {{ $t('templates.new') }}
        </button>
      </div>
    </div>
    <FormAlert :message="message?.text" :tone="message?.tone" />

    <form v-if="creating" class="card space-y-4 p-6" @submit.prevent="create">
      <div class="grid gap-4 sm:grid-cols-3">
        <div>
          <label class="label" for="t-name">{{ $t('templates.name') }}</label>
          <input id="t-name" v-model="draft.name" class="input ltr" required pattern="[a-z0-9_]+" />
          <p class="mt-1 text-xs text-slate-500">{{ $t('templates.nameHint') }}</p>
        </div>
        <div>
          <label class="label" for="t-lang">{{ $t('templates.language') }}</label>
          <select id="t-lang" v-model="draft.language" class="input">
            <option value="ar">العربية (ar)</option>
            <option value="en">English (en)</option>
            <option value="en_US">English US (en_US)</option>
          </select>
        </div>
        <div>
          <label class="label" for="t-cat">{{ $t('templates.category') }}</label>
          <select id="t-cat" v-model="draft.category" class="input">
            <option value="UTILITY">{{ $t('templates.categories.UTILITY') }}</option>
            <option value="MARKETING">{{ $t('templates.categories.MARKETING') }}</option>
          </select>
        </div>
      </div>
      <div>
        <label class="label" for="t-header">{{ $t('templates.header') }}</label>
        <input id="t-header" v-model="draft.header" class="input" maxlength="60" dir="auto" />
      </div>
      <div>
        <label class="label" for="t-body">{{ $t('templates.body') }}</label>
        <textarea
          id="t-body"
          v-model="draft.body"
          class="input min-h-28"
          required
          maxlength="1024"
          dir="auto"
        />
        <p class="mt-1 text-xs text-slate-500">{{ $t('templates.bodyHint') }}</p>
      </div>
      <fieldset v-if="varCount" class="grid gap-2 sm:grid-cols-2">
        <legend class="label">{{ $t('templates.examples') }}</legend>
        <input
          v-for="(_, i) in draft.examples"
          :key="i"
          v-model="draft.examples[i]"
          class="input"
          required
          dir="auto"
          :placeholder="$t('templates.example', { n: i + 1 })"
        />
      </fieldset>
      <div>
        <label class="label" for="t-footer">{{ $t('templates.footer') }}</label>
        <input id="t-footer" v-model="draft.footer" class="input" maxlength="60" dir="auto" />
      </div>
      <div>
        <span class="label">{{ $t('templates.buttons') }}</span>
        <div class="flex flex-wrap gap-2">
          <input
            v-for="(_, i) in draft.buttons"
            :key="i"
            v-model="draft.buttons[i]"
            class="input w-40"
            maxlength="25"
            dir="auto"
          />
          <button
            v-if="draft.buttons.length < 3"
            type="button"
            class="btn-secondary"
            @click="draft.buttons.push('')"
          >
            {{ $t('templates.addButton') }}
          </button>
        </div>
      </div>
      <FormAlert :message="createError" />
      <div class="flex gap-3">
        <button type="button" class="btn-secondary" @click="creating = false">
          {{ $t('common.cancel') }}
        </button>
        <button type="submit" class="btn-primary" :disabled="createBusy">
          {{ $t('templates.submit') }}
        </button>
      </div>
    </form>

    <p v-if="!templates?.length && !creating" class="card p-6 text-center text-sm text-slate-500">
      {{ $t('templates.empty') }}
    </p>
    <ul v-else class="grid gap-4 md:grid-cols-2">
      <li v-for="tpl in templates" :key="tpl.id" class="card space-y-2 p-5">
        <div class="flex items-start justify-between gap-2">
          <div>
            <p class="ltr font-mono text-sm font-semibold">{{ tpl.name }}</p>
            <p class="text-xs text-slate-500">
              {{ tpl.language }} · {{ $t(`templates.categories.${tpl.category}`) }}
            </p>
          </div>
          <span class="badge" :class="statusClass(tpl.status)">{{
            $t(`templates.status.${tpl.status}`, tpl.status)
          }}</span>
        </div>
        <p
          class="line-clamp-4 whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800"
          dir="auto"
        >
          {{ bodyOf(tpl) }}
        </p>
        <p v-if="tpl.rejectedReason" class="text-xs text-rose-700">{{ tpl.rejectedReason }}</p>
        <button type="button" class="text-sm font-medium text-rose-600" @click="remove(tpl.id)">
          {{ $t('common.delete') }}
        </button>
      </li>
    </ul>
  </div>
</template>
