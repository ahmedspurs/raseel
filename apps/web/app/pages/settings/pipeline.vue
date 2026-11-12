<script setup lang="ts">
import { ChevronDown, ChevronUp, X } from 'lucide-vue-next'
import type { PipelineInfo, StageInfo } from '~/types/sales'

definePageMeta({
  middleware: [() => (useAuthStore().can('settings:manage') ? undefined : navigateTo('/settings'))],
})

const api = useApi()
const toMessage = useApiError()
const { t } = useI18n()

const { data } = await useAsyncData('pipeline-settings', () =>
  api<{ pipelines: PipelineInfo[] }>('/pipelines').then((r) => r.pipelines[0]!),
)
const name = ref(data.value?.name ?? '')
const stages = ref<(Pick<StageInfo, 'name' | 'kind'> & { id?: string })[]>(
  (data.value?.stages ?? []).map((s) => ({ id: s.id, name: s.name, kind: s.kind })),
)
const message = ref<{ text: string; tone: 'error' | 'success' } | null>(null)

function move(i: number, delta: number) {
  const j = i + delta
  if (j < 0 || j >= stages.value.length) return
  const [s] = stages.value.splice(i, 1)
  stages.value.splice(j, 0, s!)
}

async function save() {
  message.value = null
  try {
    await api(`/pipelines/${data.value!.id}`, {
      method: 'PUT',
      body: { name: name.value, stages: stages.value },
    })
    message.value = { text: t('common.saved'), tone: 'success' }
  } catch (err) {
    message.value = { text: toMessage(err), tone: 'error' }
  }
}
</script>

<template>
  <form class="card max-w-2xl space-y-4 p-6" @submit.prevent="save">
    <h2 class="text-lg font-semibold">{{ $t('pipeline.title') }}</h2>
    <input v-model="name" class="input" required maxlength="60" dir="auto" />
    <ul class="space-y-2">
      <li v-for="(s, i) in stages" :key="s.id ?? i" class="flex items-center gap-2">
        <div class="flex flex-col">
          <button
            type="button"
            class="px-1 text-xs text-slate-500"
            :disabled="i === 0"
            @click="move(i, -1)"
          >
            <ChevronUp class="size-4" :stroke-width="1.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="px-1 text-xs text-slate-500"
            :disabled="i === stages.length - 1"
            @click="move(i, 1)"
          >
            <ChevronDown class="size-4" :stroke-width="1.5" aria-hidden="true" />
          </button>
        </div>
        <input v-model="s.name" class="input flex-1" required maxlength="40" dir="auto" />
        <select v-model="s.kind" class="input w-auto">
          <option v-for="k in ['OPEN', 'WON', 'LOST']" :key="k" :value="k">
            {{ $t(`pipeline.kinds.${k}`) }}
          </option>
        </select>
        <button
          type="button"
          class="px-2 text-rose-600"
          :disabled="stages.length === 1"
          @click="stages.splice(i, 1)"
        >
          <X class="size-4" :stroke-width="1.5" aria-hidden="true" />
        </button>
      </li>
    </ul>
    <button
      type="button"
      class="text-sm font-medium text-brand-700"
      @click="stages.push({ name: '', kind: 'OPEN' })"
    >
      + {{ $t('pipeline.addStage') }}
    </button>
    <FormAlert :message="message?.text" :tone="message?.tone" />
    <button type="submit" class="btn-primary">{{ $t('common.save') }}</button>
  </form>
</template>
