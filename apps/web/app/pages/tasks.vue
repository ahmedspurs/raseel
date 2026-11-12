<script setup lang="ts">
const { t } = useI18n()
useHead({ title: () => t('tasks.title') })
const scope = ref<'mine' | 'all'>('mine')
</script>

<template>
  <div class="mx-auto max-w-3xl px-4 py-6 md:px-8 md:py-10">
    <div class="mb-5 flex flex-wrap items-center justify-between gap-3">
      <h1 class="text-2xl font-bold">{{ $t('tasks.title') }}</h1>
      <div class="flex gap-1">
        <button
          v-for="s in ['mine', 'all'] as const"
          :key="s"
          type="button"
          class="rounded-lg px-3 py-1.5 text-sm font-medium"
          :class="scope === s ? 'bg-brand-700 text-white' : 'text-slate-600 hover:bg-slate-100'"
          @click="scope = s"
        >
          {{ $t(`tasks.${s}`) }}
        </button>
      </div>
    </div>
    <div class="card p-5">
      <TaskList :scope="scope" />
    </div>
  </div>
</template>
