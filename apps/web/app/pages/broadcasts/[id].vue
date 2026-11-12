<script setup lang="ts">
import { ArrowRight } from 'lucide-vue-next'
import type { BroadcastStats } from '~/types/sales'

interface Detail {
  broadcast: {
    id: string
    name: string
    status: string
    scheduledAt: string | null
    startedAt: string | null
    completedAt: string | null
    segment: { name: string } | null
    createdBy: { name: string } | null
  }
  template: { name: string; language: string } | null
  stats: BroadcastStats
  recipients: {
    id: string
    status: 'PENDING' | 'QUEUED' | 'SKIPPED' | 'FAILED'
    error: string | null
    messageStatus: string | null
    messageError: { message?: string } | null
    contact: { id: string; name: string | null; waId: string }
  }[]
}

const route = useRoute()
const api = useApi()
const toMessage = useApiError()
const auth = useAuthStore()
const { locale } = useI18n()
const id = computed(() => String(route.params.id))

const { data, refresh } = await useAsyncData(`broadcast-${id.value}`, () =>
  api<Detail>(`/broadcasts/${id.value}`),
)
useHead({ title: () => data.value?.broadcast.name ?? '' })

const timer = setInterval(() => {
  if (data.value && ['SENDING', 'SCHEDULED'].includes(data.value.broadcast.status)) void refresh()
}, 4000)
onBeforeUnmount(() => clearInterval(timer))

const dateFmt = computed(
  () => new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }),
)
const funnel = computed(() => {
  const s = data.value?.stats
  if (!s) return []
  return (['sent', 'delivered', 'read', 'replied'] as const).map((k) => ({
    key: k,
    value: s[k],
    pct: s.total ? Math.round((s[k] / s.total) * 100) : 0,
  }))
})

const error = ref<string | null>(null)
async function cancel() {
  try {
    await api(`/broadcasts/${id.value}/cancel`, { method: 'POST' })
    await refresh()
  } catch (err) {
    error.value = toMessage(err)
  }
}
</script>

<template>
  <div v-if="data" class="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-10">
    <NuxtLink to="/broadcasts" class="mb-3 inline-block text-sm text-slate-500"
      ><ArrowRight
        class="inline size-4 align-[-3px] ltr:-scale-x-100"
        :stroke-width="1.5"
        aria-hidden="true"
      />
      {{ $t('broadcasts.title') }}</NuxtLink
    >
    <div class="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-2xl font-bold" dir="auto">{{ data.broadcast.name }}</h1>
        <p class="text-sm text-slate-500">
          <span class="ltr font-mono">{{ data.template?.name }}</span> ·
          {{ data.broadcast.segment?.name ?? $t('broadcasts.allOptedIn') }} ·
          {{ $t(`broadcasts.status.${data.broadcast.status}`) }}
          <template v-if="data.broadcast.scheduledAt">
            · {{ dateFmt.format(new Date(data.broadcast.scheduledAt)) }}</template
          >
        </p>
      </div>
      <button
        v-if="
          auth.can('broadcasts:manage') && ['SCHEDULED', 'SENDING'].includes(data.broadcast.status)
        "
        type="button"
        class="btn-danger"
        @click="cancel"
      >
        {{ $t('broadcasts.cancel') }}
      </button>
    </div>
    <FormAlert :message="error" class="mb-4" />

    <section class="card mb-6 p-6">
      <h2 class="mb-4 font-semibold">{{ $t('broadcasts.report') }}</h2>
      <p class="mb-4 text-3xl font-bold">
        {{ data.stats.total }}
        <span class="text-base font-normal text-slate-500">{{ $t('broadcasts.stats.total') }}</span>
      </p>
      <ul class="space-y-3">
        <li v-for="f in funnel" :key="f.key">
          <div class="mb-1 flex justify-between text-sm">
            <span>{{ $t(`broadcasts.stats.${f.key}`) }}</span>
            <span class="font-semibold">{{ f.value }} · {{ f.pct }}%</span>
          </div>
          <div class="h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
            <div
              class="h-full rounded-full bg-brand-600 transition-all"
              :style="{ width: `${f.pct}%` }"
            />
          </div>
        </li>
      </ul>
      <p class="mt-4 flex flex-wrap gap-4 text-sm text-slate-500">
        <span>{{ $t('broadcasts.stats.pending') }}: {{ data.stats.pending }}</span>
        <span>{{ $t('broadcasts.stats.skipped') }}: {{ data.stats.skipped }}</span>
        <span class="text-rose-700"
          >{{ $t('broadcasts.stats.failed') }}: {{ data.stats.failed }}</span
        >
      </p>
    </section>

    <section class="card overflow-x-auto">
      <h2 class="px-5 pt-4 font-semibold">{{ $t('broadcasts.recipients') }}</h2>
      <table class="mt-2 w-full text-sm">
        <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
          <tr v-for="r in data.recipients" :key="r.id">
            <td class="px-5 py-2.5">
              <NuxtLink :to="`/contacts/${r.contact.id}`" class="font-medium text-brand-800">{{
                r.contact.name ?? `+${r.contact.waId}`
              }}</NuxtLink>
            </td>
            <td class="px-5 py-2.5 text-slate-600">
              {{
                r.messageStatus
                  ? $t(`inbox.status.${r.messageStatus}`)
                  : $t(`broadcasts.recipientStatus.${r.status}`)
              }}
            </td>
            <td class="px-5 py-2.5 text-xs text-rose-700" dir="auto">
              {{ r.messageError?.message ?? r.error ?? '' }}
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>
