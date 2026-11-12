<script setup lang="ts">
import type { DealInfo, PipelineInfo } from '~/types/sales'

const { t } = useI18n()
useHead({ title: () => t('deals.title') })

const api = useApi()
const toMessage = useApiError()
const auth = useAuthStore()
const directory = useDirectoryStore()
const money = useMoney()
const { shortDate } = useFormat()

const { data: pipelines } = await useAsyncData('pipelines', () =>
  api<{ pipelines: PipelineInfo[] }>('/pipelines').then((r) => r.pipelines),
)
const pipeline = computed(() => pipelines.value?.[0] ?? null)
const deals = ref<DealInfo[]>([])

async function load() {
  if (!pipeline.value) return
  deals.value = (
    await api<{ deals: DealInfo[] }>('/deals', { query: { pipelineId: pipeline.value.id } })
  ).deals
}
onMounted(() => {
  void load()
  void directory.load()
})

const columns = computed(() =>
  (pipeline.value?.stages ?? []).map((stage) => {
    const items = deals.value
      .filter((d) => d.stageId === stage.id)
      .sort((a, b) => a.position - b.position)
    return { stage, items, total: items.reduce((sum, d) => sum + d.valueSar, 0) }
  }),
)

const canEdit = computed(() => auth.can('deals:edit'))
const error = ref<string | null>(null)

// ── Drag and drop between columns ──
const dragging = ref<string | null>(null)
const overStage = ref<string | null>(null)

async function drop(stageId: string, position: number) {
  const id = dragging.value
  dragging.value = null
  overStage.value = null
  if (!id) return
  const deal = deals.value.find((d) => d.id === id)
  if (!deal) return
  // Optimistic: place it, then let the server confirm the order.
  deal.stageId = stageId
  deal.position = position - 0.5
  try {
    await api(`/deals/${id}`, { method: 'PATCH', body: { stageId, position } })
  } catch (err) {
    error.value = toMessage(err)
  }
  await load()
}

// ── New deal ──
const creating = ref<{ stageId: string } | null>(null)
const draft = reactive({ title: '', contactId: '', valueSar: 0, expectedClose: '' })
async function create() {
  if (!creating.value) return
  error.value = null
  try {
    await api('/deals', {
      method: 'POST',
      body: {
        ...draft,
        stageId: creating.value.stageId,
        expectedClose: draft.expectedClose || null,
      },
    })
    creating.value = null
    Object.assign(draft, { title: '', contactId: '', valueSar: 0, expectedClose: '' })
    await load()
  } catch (err) {
    error.value = toMessage(err)
  }
}

async function remove(id: string) {
  await api(`/deals/${id}`, { method: 'DELETE' })
  await load()
}

const kindClass = (kind: string) =>
  kind === 'WON'
    ? 'border-t-emerald-500'
    : kind === 'LOST'
      ? 'border-t-rose-400'
      : 'border-t-brand-600'
</script>

<template>
  <div class="flex h-[calc(100dvh-4.5rem)] flex-col md:h-dvh">
    <header class="flex flex-wrap items-center justify-between gap-3 px-4 py-4 md:px-8">
      <h1 class="text-2xl font-bold">{{ $t('deals.title') }}</h1>
      <button
        v-if="canEdit && pipeline"
        type="button"
        class="btn-primary"
        @click="creating = { stageId: pipeline.stages[0]!.id }"
      >
        {{ $t('deals.new') }}
      </button>
    </header>
    <FormAlert :message="error" class="mx-4 mb-2 md:mx-8" />

    <form
      v-if="creating"
      class="card mx-4 mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5 md:mx-8"
      @submit.prevent="create"
    >
      <div class="lg:col-span-2">
        <label class="label" for="d-title">{{ $t('deals.titleLabel') }}</label>
        <input
          id="d-title"
          v-model="draft.title"
          class="input"
          required
          maxlength="120"
          dir="auto"
        />
      </div>
      <div class="lg:col-span-2">
        <label class="label" for="d-contact">{{ $t('deals.contact') }}</label>
        <ContactPicker id="d-contact" v-model="draft.contactId" />
      </div>
      <div>
        <label class="label" for="d-value">{{ $t('deals.value') }}</label>
        <input
          id="d-value"
          v-model.number="draft.valueSar"
          type="number"
          min="0"
          step="0.01"
          class="input ltr"
        />
      </div>
      <div>
        <label class="label" for="d-stage">{{ $t('deals.stage') }}</label>
        <select id="d-stage" v-model="creating.stageId" class="input">
          <option v-for="s in pipeline?.stages" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
      </div>
      <div>
        <label class="label" for="d-close">{{ $t('deals.expectedClose') }}</label>
        <input id="d-close" v-model="draft.expectedClose" type="date" class="input ltr" />
      </div>
      <div class="flex items-end gap-2 lg:col-span-3">
        <button type="button" class="btn-secondary" @click="creating = null">
          {{ $t('common.cancel') }}
        </button>
        <button type="submit" class="btn-primary" :disabled="!draft.contactId">
          {{ $t('common.create') }}
        </button>
      </div>
    </form>

    <div class="flex flex-1 gap-3 overflow-x-auto px-4 pb-4 md:px-8">
      <section
        v-for="col in columns"
        :key="col.stage.id"
        class="flex w-72 shrink-0 flex-col rounded-2xl border-t-4 bg-slate-100 dark:bg-slate-900"
        :class="[
          kindClass(col.stage.kind),
          { 'ring-2 ring-brand-500': overStage === col.stage.id },
        ]"
        @dragover.prevent="overStage = col.stage.id"
        @dragleave="overStage = null"
        @drop.prevent="drop(col.stage.id, col.items.length)"
      >
        <header class="px-3 py-2.5">
          <p class="font-semibold">{{ col.stage.name }}</p>
          <p class="text-xs text-slate-500">
            {{ $t('deals.total', { count: col.items.length, value: money(col.total) }) }}
          </p>
        </header>
        <ul class="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
          <li
            v-for="(d, i) in col.items"
            :key="d.id"
            class="card cursor-grab p-3 text-sm active:cursor-grabbing"
            :class="{ 'opacity-50': dragging === d.id }"
            :draggable="canEdit"
            @dragstart="dragging = d.id"
            @dragend="dragging = null"
            @drop.prevent.stop="drop(col.stage.id, i)"
          >
            <p class="font-medium" dir="auto">{{ d.title }}</p>
            <NuxtLink
              :to="`/contacts/${d.contact.id}`"
              class="mt-0.5 block truncate text-xs text-brand-700"
              @click.stop
            >
              {{ d.contact.name ?? `+${d.contact.waId}` }}
            </NuxtLink>
            <div class="mt-2 flex items-center justify-between text-xs text-slate-500">
              <span class="font-semibold text-slate-800 dark:text-slate-200">{{
                money(d.valueSar)
              }}</span>
              <span v-if="d.expectedClose">{{ shortDate(d.expectedClose) }}</span>
            </div>
            <div class="mt-1 flex items-center justify-between text-xs text-slate-500">
              <span>{{ d.owner?.name ?? '—' }}</span>
              <span v-if="d.openTasks">{{ $t('deals.openTasks', { n: d.openTasks }) }}</span>
            </div>
            <button
              v-if="canEdit"
              type="button"
              class="mt-1 text-xs text-rose-600"
              @click="remove(d.id)"
            >
              {{ $t('common.delete') }}
            </button>
          </li>
          <li
            v-if="!col.items.length"
            class="rounded-xl border-2 border-dashed border-slate-300 p-4 text-center text-xs text-slate-400 dark:border-slate-700"
          >
            {{ $t('deals.empty') }}
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
