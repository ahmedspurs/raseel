<script setup lang="ts">
import type { CustomFieldDef, TagInfo } from '~/types/crm'
import type { SegmentFilter, SegmentInfo } from '~/types/sales'

definePageMeta({
  middleware: [
    () => (useAuthStore().can('broadcasts:manage') ? undefined : navigateTo('/settings')),
  ],
})

const api = useApi()
const toMessage = useApiError()

const { data, refresh } = await useAsyncData('segments', async () => {
  const [s, tg, cf] = await Promise.all([
    api<{ segments: SegmentInfo[] }>('/segments'),
    api<{ tags: TagInfo[] }>('/tags'),
    api<{ customFields: CustomFieldDef[] }>('/custom-fields'),
  ])
  return { segments: s.segments, tags: tg.tags, fields: cf.customFields }
})

type Draft = {
  id: string | null
  name: string
  filter: SegmentFilter
  conditions: { key: string; value: string }[]
}
const editing = ref<Draft | null>(null)
const error = ref<string | null>(null)
const preview = ref<{ audience: number; matching: number } | null>(null)

const emptyFilter = (): SegmentFilter => ({
  tagIds: [],
  tagMatch: 'any',
  fields: {},
  language: null,
})
function startNew() {
  editing.value = { id: null, name: '', filter: emptyFilter(), conditions: [] }
}
function startEdit(s: SegmentInfo) {
  editing.value = {
    id: s.id,
    name: s.name,
    filter: structuredClone(toRaw(s.filter)),
    conditions: Object.entries(s.filter.fields).map(([key, value]) => ({ key, value })),
  }
}

const builtFilter = computed<SegmentFilter | null>(() => {
  const d = editing.value
  if (!d) return null
  return {
    ...d.filter,
    fields: Object.fromEntries(
      d.conditions.filter((c) => c.key && c.value).map((c) => [c.key, c.value]),
    ),
  }
})

let debounce: ReturnType<typeof setTimeout> | undefined
watch(
  builtFilter,
  (filter) => {
    clearTimeout(debounce)
    if (!filter) return
    debounce = setTimeout(async () => {
      preview.value = await api('/segments/preview', { method: 'POST', body: { filter } })
    }, 300)
  },
  { deep: true },
)

function toggleTag(id: string) {
  const tags = editing.value!.filter.tagIds
  const i = tags.indexOf(id)
  if (i >= 0) tags.splice(i, 1)
  else tags.push(id)
}

async function save() {
  const d = editing.value
  if (!d || !builtFilter.value) return
  error.value = null
  try {
    await api(d.id ? `/segments/${d.id}` : '/segments', {
      method: d.id ? 'PUT' : 'POST',
      body: { name: d.name, filter: builtFilter.value },
    })
    editing.value = null
    await refresh()
  } catch (err) {
    error.value = toMessage(err)
  }
}
async function remove(id: string) {
  await api(`/segments/${id}`, { method: 'DELETE' })
  await refresh()
}
const tagName = (id: string) => data.value?.tags.find((x) => x.id === id)?.name ?? '—'
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <h2 class="text-lg font-semibold">{{ $t('segments.title') }}</h2>
      <button type="button" class="btn-primary" @click="startNew">{{ $t('segments.new') }}</button>
    </div>

    <form v-if="editing" class="card space-y-4 p-6" @submit.prevent="save">
      <div>
        <label class="label" for="s-name">{{ $t('segments.name') }}</label>
        <input
          id="s-name"
          v-model="editing.name"
          class="input"
          required
          maxlength="80"
          dir="auto"
        />
      </div>
      <div>
        <div class="mb-1.5 flex items-center gap-2">
          <span class="label mb-0">{{ $t('segments.tags') }}</span>
          <select v-model="editing.filter.tagMatch" class="input w-auto py-1 text-sm">
            <option value="any">{{ $t('segments.any') }}</option>
            <option value="all">{{ $t('segments.all') }}</option>
          </select>
        </div>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="tg in data?.tags"
            :key="tg.id"
            type="button"
            class="rounded-full border px-3 py-1 text-sm"
            :style="
              editing.filter.tagIds.includes(tg.id)
                ? { backgroundColor: tg.color, borderColor: tg.color, color: '#fff' }
                : { borderColor: tg.color, color: tg.color }
            "
            :aria-pressed="editing.filter.tagIds.includes(tg.id)"
            @click="toggleTag(tg.id)"
          >
            {{ tg.name }}
          </button>
        </div>
      </div>
      <div class="space-y-2">
        <span class="label">{{ $t('segments.field') }}</span>
        <div v-for="(c, i) in editing.conditions" :key="i" class="flex gap-2">
          <select v-model="c.key" class="input w-auto">
            <option v-for="f in data?.fields" :key="f.key" :value="f.key">{{ f.label }}</option>
          </select>
          <input v-model="c.value" class="input flex-1" dir="auto" />
          <button
            type="button"
            class="px-2 text-slate-500"
            @click="editing.conditions.splice(i, 1)"
          >
            ✕
          </button>
        </div>
        <button
          v-if="data?.fields.length"
          type="button"
          class="text-sm font-medium text-brand-700"
          @click="editing.conditions.push({ key: data!.fields[0]!.key, value: '' })"
        >
          + {{ $t('segments.addCondition') }}
        </button>
      </div>
      <div>
        <label class="label" for="s-lang">{{ $t('segments.language') }}</label>
        <select id="s-lang" v-model="editing.filter.language" class="input w-auto">
          <option :value="null">{{ $t('segments.anyLanguage') }}</option>
          <option value="ar">العربية</option>
          <option value="en">English</option>
        </select>
      </div>
      <p
        v-if="preview"
        class="rounded-xl bg-brand-50 p-3 text-sm font-medium text-brand-900 dark:bg-brand-900/30 dark:text-brand-100"
      >
        {{ $t('segments.preview', preview) }}
      </p>
      <FormAlert :message="error" />
      <div class="flex gap-2">
        <button type="button" class="btn-secondary" @click="editing = null">
          {{ $t('common.cancel') }}
        </button>
        <button type="submit" class="btn-primary">{{ $t('common.save') }}</button>
      </div>
    </form>

    <p
      v-if="!data?.segments.length && !editing"
      class="card p-6 text-center text-sm text-slate-500"
    >
      {{ $t('segments.empty') }}
    </p>
    <ul v-else class="card divide-y divide-slate-100 dark:divide-slate-800">
      <li
        v-for="s in data?.segments"
        :key="s.id"
        class="flex flex-wrap items-center gap-3 px-4 py-3"
      >
        <div class="min-w-0 flex-1">
          <p class="font-medium" dir="auto">{{ s.name }}</p>
          <p class="text-xs text-slate-500">
            {{
              s.filter.tagIds.map(tagName).join(s.filter.tagMatch === 'all' ? ' + ' : ' / ') || '—'
            }}
            <template v-for="(v, k) in s.filter.fields" :key="k"> · {{ k }} = {{ v }}</template>
          </p>
        </div>
        <span class="badge bg-brand-50 text-brand-800">{{
          $t('broadcasts.audience', { n: s.audience })
        }}</span>
        <button type="button" class="text-sm font-medium text-brand-700" @click="startEdit(s)">
          {{ $t('common.edit') }}
        </button>
        <button type="button" class="text-sm font-medium text-rose-600" @click="remove(s.id)">
          {{ $t('common.delete') }}
        </button>
      </li>
    </ul>
  </div>
</template>
