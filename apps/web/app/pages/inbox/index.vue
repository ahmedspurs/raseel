<script setup lang="ts">
const { t } = useI18n()
useHead({ title: () => t('nav.inbox') })
const auth = useAuthStore()
</script>

<template>
  <div class="grid min-h-[calc(100dvh-4.5rem)] place-items-center p-6 md:min-h-dvh">
    <div class="max-w-sm text-center">
      <div
        class="mx-auto mb-5 grid size-16 place-items-center rounded-2xl bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200"
      >
        <svg
          viewBox="0 0 24 24"
          class="size-8"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linejoin="round"
        >
          <path d="M4 5h16v10h-5l-3 3-3-3H4z" />
        </svg>
      </div>
      <h1 class="text-xl font-bold">{{ $t('inbox.emptyTitle') }}</h1>
      <p class="mt-2 text-slate-600 dark:text-slate-400">{{ $t('inbox.emptyBody') }}</p>
      <NuxtLink v-if="auth.can('whatsapp:manage')" to="/settings/business" class="btn-primary mt-6">
        {{ $t('nav.settings') }}
      </NuxtLink>
    </div>
  </div>
</template>
