<script setup lang="ts">
import type { BroadcastInfo } from '~/types/sales'

const { t, locale } = useI18n()
useHead({ title: () => t('broadcasts.title') })
const api = useApi()
const auth = useAuthStore()

const { data: broadcasts, refresh } = await useAsyncData('broadcasts', () =>
  api<{ broadcasts: BroadcastInfo[] }>('/broadcasts').then((r) => r.broadcasts),
)
// Sending campaigns update their numbers live.
const timer = setInterval(() => {
  if (broadcasts.value?.some((b) => b.status === 'SENDING' || b.status === 'SCHEDULED'))
    void refresh()
}, 5000)
onBeforeUnmount(() => clearInterval(timer))

const dateFmt = computed(
  () => new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }),
)
const pct = (n: number, total: number) => (total ? Math.round((n / total) * 100) : 0)
const statusClass: Record<string, string> = {
  SCHEDULED: 'bg-sky-100 text-sky-800',
  SENDING: 'bg-amber-100 text-amber-800',
  COMPLETED: 'bg-emerald-100 text-emerald-800',
  CANCELLED: 'bg-slate-100 text-slate-600',
  DRAFT: 'bg-slate-100 text-slate-600',
}
</script>

<template>
  <div class="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-10">
    <div class="mb-5 flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-2xl font-bold">{{ $t('broadcasts.title') }}</h1>
      <NuxtLink v-if="auth.can('broadcasts:manage')" to="/broadcasts/new" class="btn-primary">{{
        $t('broadcasts.new')
      }}</NuxtLink>
    </div>

    <p v-if="!broadcasts?.length" class="card p-8 text-center text-slate-500">
      {{ $t('broadcasts.empty') }}
    </p>
    <ul v-else class="space-y-3">
      <li v-for="b in broadcasts" :key="b.id">
        <NuxtLink :to="`/broadcasts/${b.id}`" class="card block p-5 hover:border-brand-300">
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p class="font-semibold" dir="auto">{{ b.name }}</p>
              <p class="text-xs text-slate-500">
                <span class="ltr font-mono">{{ b.template?.name }}</span> ·
                {{ b.segment?.name ?? $t('broadcasts.allOptedIn') }} ·
                {{ dateFmt.format(new Date(b.scheduledAt ?? b.createdAt)) }}
              </p>
            </div>
            <span class="badge" :class="statusClass[b.status]">{{
              $t(`broadcasts.status.${b.status}`)
            }}</span>
          </div>
          <dl class="mt-4 grid grid-cols-3 gap-2 text-center text-sm sm:grid-cols-6">
            <div
              v-for="k in ['total', 'sent', 'delivered', 'read', 'replied', 'failed'] as const"
              :key="k"
            >
              <dt class="text-xs text-slate-500">{{ $t(`broadcasts.stats.${k}`) }}</dt>
              <dd class="font-semibold">
                {{ b.stats[k] }}
                <span
                  v-if="k !== 'total' && b.stats.total"
                  class="text-xs font-normal text-slate-400"
                  >{{ pct(b.stats[k], b.stats.total) }}%</span
                >
              </dd>
            </div>
          </dl>
        </NuxtLink>
      </li>
    </ul>
  </div>
</template>
