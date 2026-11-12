<script setup lang="ts">
import { ArrowRight } from 'lucide-vue-next'
import type { CustomFieldDef, TemplateInfo } from '~/types/crm'
import type { SegmentInfo } from '~/types/sales'

definePageMeta({
  middleware: [
    () => (useAuthStore().can('broadcasts:manage') ? undefined : navigateTo('/broadcasts')),
  ],
})

const { t } = useI18n()
useHead({ title: () => t('broadcasts.new') })
const api = useApi()
const toMessage = useApiError()

const { data } = await useAsyncData('broadcast-new', async () => {
  const [tpl, seg, cf] = await Promise.all([
    api<{ templates: TemplateInfo[] }>('/templates'),
    api<{ segments: SegmentInfo[] }>('/segments'),
    api<{ customFields: CustomFieldDef[] }>('/custom-fields'),
  ])
  return {
    templates: tpl.templates.filter((x) => x.status === 'APPROVED'),
    segments: seg.segments,
    customFields: cf.customFields,
  }
})

const form = reactive({
  name: '',
  templateId: '',
  segmentId: '' as string,
  when: 'now' as 'now' | 'later',
  scheduledAt: '',
  headerMediaUrl: '',
})

const template = computed(() => data.value?.templates.find((x) => x.id === form.templateId))
const countVars = (text?: string) =>
  Math.max(0, ...[...(text ?? '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1])))
const header = computed(() => template.value?.components.find((c) => c.type === 'HEADER'))
const body = computed(() => template.value?.components.find((c) => c.type === 'BODY'))
const varCount = computed(
  () =>
    (header.value?.format === 'TEXT' ? countVars(header.value.text) : 0) +
    countVars(body.value?.text),
)
const needsMedia = computed(
  () => !!header.value?.format && !['TEXT', 'LOCATION'].includes(header.value.format),
)

type Slot = { mode: 'value' | 'field'; value: string; field: string }
const slots = ref<Slot[]>([])
watch(varCount, (n) => {
  slots.value = Array.from(
    { length: n },
    (_, i) => slots.value[i] ?? { mode: 'field', value: '', field: 'contact.firstName' },
  )
})
const fieldOptions = computed(() => [
  ...['name', 'firstName', 'phone', 'email', 'company', 'city'].map((f) => ({
    value: `contact.${f}`,
    label: t(`templates.fields.${f}`),
  })),
  ...(data.value?.customFields ?? []).map((f) => ({ value: `custom.${f.key}`, label: f.label })),
])

const audience = ref<number | null>(null)
watch(
  () => form.segmentId,
  async (segmentId) => {
    audience.value = (
      await api<{ audience: number }>('/broadcasts/audience', {
        method: 'POST',
        body: { segmentId: segmentId || null },
      })
    ).audience
  },
  { immediate: true },
)

const busy = ref(false)
const error = ref<string | null>(null)
async function create() {
  busy.value = true
  error.value = null
  try {
    const res = await api<{ broadcast: { id: string } }>('/broadcasts', {
      method: 'POST',
      body: {
        name: form.name,
        templateId: form.templateId,
        segmentId: form.segmentId || null,
        variables: slots.value.map((s) =>
          s.mode === 'value' ? { value: s.value } : { field: s.field },
        ),
        headerMediaUrl: needsMedia.value ? form.headerMediaUrl : null,
        scheduledAt:
          form.when === 'later' && form.scheduledAt
            ? new Date(form.scheduledAt).toISOString()
            : null,
      },
    })
    await navigateTo(`/broadcasts/${res.broadcast.id}`)
  } catch (err) {
    error.value = toMessage(err)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-10">
    <NuxtLink to="/broadcasts" class="mb-3 inline-block text-sm text-slate-500"
      ><ArrowRight
        class="inline size-4 align-[-3px] ltr:-scale-x-100"
        :stroke-width="1.5"
        aria-hidden="true"
      />
      {{ $t('broadcasts.title') }}</NuxtLink
    >
    <h1 class="mb-5 text-2xl font-bold">{{ $t('broadcasts.new') }}</h1>

    <p v-if="data && !data.templates.length" class="card p-5 text-sm text-amber-900">
      {{ $t('templates.noApproved') }}
    </p>

    <form v-else class="card space-y-5 p-6" @submit.prevent="create">
      <div>
        <label class="label" for="b-name">{{ $t('broadcasts.name') }}</label>
        <input id="b-name" v-model="form.name" class="input" required maxlength="120" dir="auto" />
      </div>

      <div>
        <label class="label" for="b-tpl">{{ $t('broadcasts.template') }}</label>
        <select id="b-tpl" v-model="form.templateId" class="input" required>
          <option value="" disabled>—</option>
          <option v-for="tp in data?.templates" :key="tp.id" :value="tp.id">
            {{ tp.name }} · {{ tp.language }} · {{ $t(`templates.categories.${tp.category}`) }}
          </option>
        </select>
        <p
          v-if="body?.text"
          class="mt-2 rounded-xl bg-slate-50 p-3 text-sm whitespace-pre-wrap dark:bg-slate-800"
          dir="auto"
        >
          {{ body.text }}
        </p>
      </div>

      <div v-if="needsMedia">
        <label class="label" for="b-media">{{ $t('templates.headerMedia') }}</label>
        <input
          id="b-media"
          v-model="form.headerMediaUrl"
          type="url"
          class="input ltr"
          required
          placeholder="https://"
        />
      </div>

      <fieldset v-if="slots.length" class="space-y-2">
        <legend class="label">{{ $t('templates.variables') }}</legend>
        <div v-for="(s, i) in slots" :key="i" class="flex flex-wrap items-center gap-2">
          <span class="w-24 text-xs text-slate-500">{{
            $t('templates.variable', { n: i + 1 })
          }}</span>
          <select v-model="s.mode" class="input w-auto py-1.5 text-sm">
            <option value="field">{{ $t('templates.fromField') }}</option>
            <option value="value">{{ $t('templates.typeValue') }}</option>
          </select>
          <select v-if="s.mode === 'field'" v-model="s.field" class="input min-w-40 flex-1 py-1.5">
            <option v-for="f in fieldOptions" :key="f.value" :value="f.value">{{ f.label }}</option>
          </select>
          <input
            v-else
            v-model="s.value"
            class="input min-w-40 flex-1 py-1.5"
            required
            dir="auto"
          />
        </div>
      </fieldset>

      <div>
        <label class="label" for="b-seg">{{ $t('broadcasts.segment') }}</label>
        <select id="b-seg" v-model="form.segmentId" class="input">
          <option value="">{{ $t('broadcasts.allOptedIn') }}</option>
          <option v-for="sg in data?.segments" :key="sg.id" :value="sg.id">{{ sg.name }}</option>
        </select>
        <p
          v-if="audience !== null"
          class="mt-1.5 text-sm font-medium"
          :class="audience ? 'text-brand-800' : 'text-rose-700'"
        >
          {{ $t('broadcasts.audience', { n: audience }) }}
        </p>
        <p class="mt-1 text-xs text-slate-500">{{ $t('broadcasts.optInNote') }}</p>
      </div>

      <fieldset>
        <legend class="label">{{ $t('broadcasts.when') }}</legend>
        <div class="flex flex-wrap items-center gap-4 text-sm">
          <label class="flex items-center gap-2"
            ><input v-model="form.when" type="radio" value="now" class="accent-brand-700" />
            {{ $t('broadcasts.now') }}</label
          >
          <label class="flex items-center gap-2"
            ><input v-model="form.when" type="radio" value="later" class="accent-brand-700" />
            {{ $t('broadcasts.later') }}</label
          >
          <input
            v-if="form.when === 'later'"
            v-model="form.scheduledAt"
            type="datetime-local"
            class="input ltr w-auto"
            required
          />
        </div>
      </fieldset>

      <p class="rounded-xl bg-sky-50 p-3 text-xs text-sky-900 dark:bg-sky-950 dark:text-sky-100">
        {{ $t('broadcasts.tierNote') }}
      </p>
      <FormAlert :message="error" />
      <button type="submit" class="btn-primary" :disabled="busy || !audience">
        {{ $t('broadcasts.create') }}
      </button>
    </form>
  </div>
</template>
