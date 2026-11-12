<script setup lang="ts">
import type { ContactInfo, CustomFieldDef, TemplateInfo } from '~/types/crm'

const props = defineProps<{
  contact: Pick<
    ContactInfo,
    'id' | 'displayName' | 'waId' | 'city' | 'company' | 'email' | 'customFields'
  >
}>()
const emit = defineEmits<{ sent: [conversationId: string]; close: [] }>()

const api = useApi()
const toMessage = useApiError()
const { t } = useI18n()

const { data } = await useAsyncData(`template-sender-${props.contact.id}`, async () => {
  const [tpl, cf] = await Promise.all([
    api<{ templates: TemplateInfo[] }>('/templates'),
    api<{ customFields: CustomFieldDef[] }>('/custom-fields'),
  ])
  return {
    templates: tpl.templates.filter((x) => x.status === 'APPROVED'),
    customFields: cf.customFields,
  }
})

const selectedId = ref('')
const selected = computed(
  () => data.value?.templates.find((x) => x.id === selectedId.value) ?? null,
)
const header = computed(() => selected.value?.components.find((c) => c.type === 'HEADER'))
const body = computed(() => selected.value?.components.find((c) => c.type === 'BODY'))
const footer = computed(() => selected.value?.components.find((c) => c.type === 'FOOTER'))

const countVars = (text?: string) =>
  Math.max(0, ...[...(text ?? '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1])))
const headerVars = computed(() =>
  header.value?.format === 'TEXT' ? countVars(header.value.text) : 0,
)
const bodyVars = computed(() => countVars(body.value?.text))
const needsMedia = computed(
  () => !!header.value?.format && !['TEXT', 'LOCATION'].includes(header.value.format),
)

type Slot = { mode: 'value' | 'field'; value: string; field: string }
const slots = ref<Slot[]>([])
const headerMediaUrl = ref('')
watch(selected, () => {
  const n = headerVars.value + bodyVars.value
  slots.value = Array.from({ length: n }, (_, i) => ({
    mode: i === headerVars.value ? 'field' : 'value',
    value: '',
    field: 'contact.firstName',
  }))
  headerMediaUrl.value = ''
})

const fieldOptions = computed(() => [
  ...[
    'contact.name',
    'contact.firstName',
    'contact.phone',
    'contact.email',
    'contact.company',
    'contact.city',
  ].map((f) => ({ value: f, label: t(`templates.fields.${f.split('.')[1]}`) })),
  ...(data.value?.customFields ?? []).map((f) => ({ value: `custom.${f.key}`, label: f.label })),
])

/** What the contact field resolves to, for the live preview. */
function resolve(field: string): string {
  const c = props.contact
  const map: Record<string, string | null | undefined> = {
    'contact.name': c.displayName,
    'contact.firstName': c.displayName?.split(/\s+/)[0],
    'contact.phone': `+${c.waId}`,
    'contact.email': c.email,
    'contact.company': c.company,
    'contact.city': c.city,
  }
  if (field.startsWith('custom.')) return String(c.customFields?.[field.slice(7)] ?? '')
  return map[field] ?? ''
}

const values = computed(() =>
  slots.value.map((s) => (s.mode === 'value' ? s.value : resolve(s.field))),
)
const fill = (text: string | undefined, offset: number) =>
  (text ?? '').replace(
    /\{\{\s*(\d+)\s*\}\}/g,
    (m, n: string) => values.value[offset + Number(n) - 1] || m,
  )

const preview = computed(() =>
  [
    header.value?.format === 'TEXT' ? fill(header.value.text, 0) : null,
    fill(body.value?.text, headerVars.value),
    footer.value?.text,
  ]
    .filter(Boolean)
    .join('\n\n'),
)

const busy = ref(false)
const error = ref<string | null>(null)

async function send() {
  if (!selected.value) return
  busy.value = true
  error.value = null
  try {
    const res = await api<{ conversationId: string }>(`/contacts/${props.contact.id}/template`, {
      method: 'POST',
      body: {
        templateId: selected.value.id,
        variables: slots.value.map((s) =>
          s.mode === 'value' ? { value: s.value } : { field: s.field },
        ),
        headerMediaUrl: needsMedia.value ? headerMediaUrl.value : undefined,
      },
    })
    emit('sent', res.conversationId)
  } catch (err) {
    error.value = toMessage(err)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div
    class="fixed inset-0 z-40 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4"
    @click.self="emit('close')"
  >
    <div
      class="card max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-b-none p-5 sm:rounded-b-2xl"
      role="dialog"
      aria-modal="true"
    >
      <div class="mb-4 flex items-center justify-between">
        <h2 class="text-lg font-semibold">
          {{ $t('contacts.sendTemplate') }} · {{ contact.displayName ?? `+${contact.waId}` }}
        </h2>
        <button
          type="button"
          class="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100"
          :aria-label="$t('common.cancel')"
          @click="emit('close')"
        >
          ✕
        </button>
      </div>

      <p
        v-if="data && !data.templates.length"
        class="rounded-xl bg-amber-50 p-3 text-sm text-amber-900"
      >
        {{ $t('templates.noApproved') }}
      </p>

      <form v-else class="space-y-4" @submit.prevent="send">
        <div>
          <label class="label" for="tpl">{{ $t('templates.choose') }}</label>
          <select id="tpl" v-model="selectedId" class="input" required>
            <option value="" disabled>—</option>
            <option v-for="tpl in data?.templates" :key="tpl.id" :value="tpl.id">
              {{ tpl.name }} · {{ tpl.language }} · {{ $t(`templates.categories.${tpl.category}`) }}
            </option>
          </select>
        </div>

        <template v-if="selected">
          <div v-if="needsMedia">
            <label class="label" for="hm"
              >{{ $t('templates.headerMedia') }} ({{ header?.format }})</label
            >
            <input
              id="hm"
              v-model="headerMediaUrl"
              type="url"
              class="input ltr"
              required
              placeholder="https://"
            />
          </div>

          <fieldset v-if="slots.length" class="space-y-2">
            <legend class="label">{{ $t('templates.variables') }}</legend>
            <div v-for="(s, i) in slots" :key="i" class="flex flex-wrap items-center gap-2">
              <span class="w-24 shrink-0 text-xs text-slate-500">{{
                $t('templates.variable', { n: i < headerVars ? i + 1 : i - headerVars + 1 })
              }}</span>
              <select v-model="s.mode" class="input w-auto py-1.5 text-sm">
                <option value="value">{{ $t('templates.typeValue') }}</option>
                <option value="field">{{ $t('templates.fromField') }}</option>
              </select>
              <input
                v-if="s.mode === 'value'"
                v-model="s.value"
                class="input min-w-40 flex-1 py-1.5"
                required
                dir="auto"
              />
              <select v-else v-model="s.field" class="input min-w-40 flex-1 py-1.5">
                <option v-for="f in fieldOptions" :key="f.value" :value="f.value">
                  {{ f.label }}
                </option>
              </select>
            </div>
          </fieldset>

          <div>
            <p class="label">{{ $t('templates.preview') }}</p>
            <div
              class="rounded-2xl bg-brand-700 px-4 py-3 text-sm whitespace-pre-wrap text-white"
              dir="auto"
            >
              {{ preview }}
            </div>
            <div
              v-if="selected.components.find((c) => c.type === 'BUTTONS')"
              class="mt-1 flex flex-wrap gap-1"
            >
              <span
                v-for="b in selected.components.find((c) => c.type === 'BUTTONS')?.buttons"
                :key="b.text"
                class="rounded-lg border border-brand-200 px-3 py-1 text-xs text-brand-800"
                >{{ b.text }}</span
              >
            </div>
          </div>
        </template>

        <FormAlert :message="error" />
        <div class="flex justify-end gap-2">
          <button type="button" class="btn-secondary" @click="emit('close')">
            {{ $t('common.cancel') }}
          </button>
          <button type="submit" class="btn-primary" :disabled="busy || !selected">
            {{ $t('templates.send') }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
