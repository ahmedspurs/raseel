<script setup lang="ts">
import type { CustomFieldDef } from '~/types/crm'

definePageMeta({
  middleware: [() => (useAuthStore().can('settings:manage') ? undefined : navigateTo('/settings'))],
})

const api = useApi()
const toMessage = useApiError()

const { data: fields, refresh } = await useAsyncData('custom-fields', () =>
  api<{ customFields: CustomFieldDef[] }>('/custom-fields').then((r) => r.customFields),
)

type Draft = {
  id: string | null
  key: string
  label: string
  type: CustomFieldDef['type']
  options: string
}
const editing = ref<Draft | null>(null)
const error = ref<string | null>(null)

function startNew() {
  editing.value = { id: null, key: '', label: '', type: 'TEXT', options: '' }
}
function startEdit(f: CustomFieldDef) {
  editing.value = { ...f, options: f.options.join('\n') }
}

async function save() {
  if (!editing.value) return
  error.value = null
  const { id, options, ...rest } = editing.value
  try {
    await api(id ? `/custom-fields/${id}` : '/custom-fields', {
      method: id ? 'PUT' : 'POST',
      body: {
        ...rest,
        options: options
          .split('\n')
          .map((o) => o.trim())
          .filter(Boolean),
      },
    })
    editing.value = null
    await refresh()
  } catch (err) {
    error.value = toMessage(err)
  }
}

async function remove(id: string) {
  await api(`/custom-fields/${id}`, { method: 'DELETE' })
  await refresh()
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 class="text-lg font-semibold">{{ $t('customFields.title') }}</h2>
        <p class="text-sm text-slate-600 dark:text-slate-400">{{ $t('customFields.intro') }}</p>
      </div>
      <button type="button" class="btn-primary" @click="startNew">
        {{ $t('customFields.new') }}
      </button>
    </div>

    <form v-if="editing" class="card grid gap-4 p-6 sm:grid-cols-3" @submit.prevent="save">
      <div>
        <label class="label" for="cf-label">{{ $t('customFields.label') }}</label>
        <input
          id="cf-label"
          v-model="editing.label"
          class="input"
          required
          maxlength="60"
          dir="auto"
        />
      </div>
      <div>
        <label class="label" for="cf-key">{{ $t('customFields.key') }}</label>
        <input
          id="cf-key"
          v-model="editing.key"
          class="input ltr font-mono"
          required
          pattern="[a-z][a-z0-9_]*"
          :disabled="!!editing.id"
        />
        <p class="mt-1 text-xs text-slate-500">{{ $t('customFields.keyHint') }}</p>
      </div>
      <div>
        <label class="label" for="cf-type">{{ $t('customFields.type') }}</label>
        <select id="cf-type" v-model="editing.type" class="input">
          <option v-for="ty in ['TEXT', 'NUMBER', 'DATE', 'SELECT']" :key="ty" :value="ty">
            {{ $t(`customFields.types.${ty}`) }}
          </option>
        </select>
      </div>
      <div v-if="editing.type === 'SELECT'" class="sm:col-span-3">
        <label class="label" for="cf-options">{{ $t('customFields.options') }}</label>
        <textarea
          id="cf-options"
          v-model="editing.options"
          class="input min-h-24"
          required
          dir="auto"
        />
      </div>
      <FormAlert :message="error" class="sm:col-span-3" />
      <div class="flex gap-2 sm:col-span-3">
        <button type="button" class="btn-secondary" @click="editing = null">
          {{ $t('common.cancel') }}
        </button>
        <button type="submit" class="btn-primary">{{ $t('common.save') }}</button>
      </div>
    </form>

    <p v-if="!fields?.length && !editing" class="card p-6 text-center text-sm text-slate-500">
      {{ $t('customFields.empty') }}
    </p>
    <ul v-else class="card divide-y divide-slate-100 dark:divide-slate-800">
      <li v-for="f in fields" :key="f.id" class="flex flex-wrap items-center gap-3 px-4 py-3">
        <span class="font-medium" dir="auto">{{ f.label }}</span>
        <code class="ltr rounded bg-slate-100 px-1.5 text-xs dark:bg-slate-800"
          >custom.{{ f.key }}</code
        >
        <span class="badge bg-slate-100 text-slate-600">{{
          $t(`customFields.types.${f.type}`)
        }}</span>
        <span v-if="f.options.length" class="truncate text-xs text-slate-500" dir="auto">{{
          f.options.join('، ')
        }}</span>
        <span class="ms-auto flex gap-3 text-sm">
          <button type="button" class="font-medium text-brand-700" @click="startEdit(f)">
            {{ $t('common.edit') }}
          </button>
          <button type="button" class="font-medium text-rose-600" @click="remove(f.id)">
            {{ $t('common.delete') }}
          </button>
        </span>
      </li>
    </ul>
  </div>
</template>
