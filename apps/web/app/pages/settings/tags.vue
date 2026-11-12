<script setup lang="ts">
import type { TagInfo } from '~/types/crm'

definePageMeta({
  middleware: [() => (useAuthStore().can('tags:manage') ? undefined : navigateTo('/settings'))],
})

const api = useApi()
const toMessage = useApiError()
const COLORS = [
  '#0f766e',
  '#2563eb',
  '#7c3aed',
  '#db2777',
  '#dc2626',
  '#ea580c',
  '#ca8a04',
  '#64748b',
]

const { data: tags, refresh } = await useAsyncData('tags', () =>
  api<{ tags: TagInfo[] }>('/tags').then((r) => r.tags),
)

const editing = ref<{ id: string | null; name: string; color: string } | null>(null)
const error = ref<string | null>(null)

async function save() {
  if (!editing.value) return
  error.value = null
  const { id, ...body } = editing.value
  try {
    await api(id ? `/tags/${id}` : '/tags', { method: id ? 'PUT' : 'POST', body })
    editing.value = null
    await refresh()
  } catch (err) {
    error.value = toMessage(err)
  }
}

async function remove(id: string) {
  await api(`/tags/${id}`, { method: 'DELETE' })
  await refresh()
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <h2 class="text-lg font-semibold">{{ $t('tags.title') }}</h2>
      <button
        type="button"
        class="btn-primary"
        @click="editing = { id: null, name: '', color: COLORS[0]! }"
      >
        {{ $t('tags.new') }}
      </button>
    </div>

    <form v-if="editing" class="card flex flex-wrap items-end gap-4 p-5" @submit.prevent="save">
      <div class="min-w-48 flex-1">
        <label class="label" for="tag-name">{{ $t('tags.name') }}</label>
        <input
          id="tag-name"
          v-model="editing.name"
          class="input"
          required
          maxlength="40"
          dir="auto"
        />
      </div>
      <fieldset>
        <legend class="label">{{ $t('tags.color') }}</legend>
        <div class="flex gap-1.5">
          <button
            v-for="c in COLORS"
            :key="c"
            type="button"
            class="size-8 rounded-full ring-offset-2"
            :class="{ 'ring-2 ring-slate-900 dark:ring-white': editing.color === c }"
            :style="{ backgroundColor: c }"
            :aria-label="c"
            :aria-pressed="editing.color === c"
            @click="editing.color = c"
          />
        </div>
      </fieldset>
      <div class="flex gap-2">
        <button type="button" class="btn-secondary" @click="editing = null">
          {{ $t('common.cancel') }}
        </button>
        <button type="submit" class="btn-primary">{{ $t('common.save') }}</button>
      </div>
      <FormAlert :message="error" class="w-full" />
    </form>

    <p v-if="!tags?.length && !editing" class="card p-6 text-center text-sm text-slate-500">
      {{ $t('tags.empty') }}
    </p>
    <ul v-else class="card divide-y divide-slate-100 dark:divide-slate-800">
      <li v-for="tg in tags" :key="tg.id" class="flex items-center gap-3 px-4 py-3">
        <span class="badge text-white" :style="{ backgroundColor: tg.color }">{{ tg.name }}</span>
        <span class="flex-1 text-sm text-slate-500">{{
          $t('tags.contacts', { n: tg.contactCount ?? 0 })
        }}</span>
        <button
          type="button"
          class="text-sm font-medium text-brand-700"
          @click="editing = { id: tg.id, name: tg.name, color: tg.color }"
        >
          {{ $t('common.edit') }}
        </button>
        <button type="button" class="text-sm font-medium text-rose-600" @click="remove(tg.id)">
          {{ $t('common.delete') }}
        </button>
      </li>
    </ul>
  </div>
</template>
