<script setup lang="ts">
import type { Permission } from '@raseel/shared'

const { t } = useI18n()
useHead({ title: () => t('settings.title') })
const auth = useAuthStore()

const tabs = computed(() =>
  (
    [
      { to: '/settings/profile', label: 'settings.profile' },
      { to: '/settings/security', label: 'settings.security' },
      { to: '/settings/business', label: 'settings.business', permission: 'settings:manage' },
      { to: '/settings/whatsapp', label: 'settings.whatsapp', permission: 'whatsapp:manage' },
      { to: '/settings/users', label: 'settings.users', permission: 'users:manage' },
      { to: '/settings/teams', label: 'settings.teams', permission: 'teams:manage' },
    ] as { to: string; label: string; permission?: Permission }[]
  ).filter((tab) => !tab.permission || auth.can(tab.permission)),
)
</script>

<template>
  <div class="mx-auto max-w-4xl px-4 py-6 md:px-8 md:py-10">
    <h1 class="mb-5 text-2xl font-bold">{{ $t('settings.title') }}</h1>
    <nav class="-mx-4 mb-6 flex gap-1 overflow-x-auto px-4 md:mx-0 md:px-0">
      <NuxtLink
        v-for="tab in tabs"
        :key="tab.to"
        :to="tab.to"
        class="whitespace-nowrap rounded-xl px-3.5 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
        active-class="!bg-brand-700 !text-white"
      >
        {{ $t(tab.label) }}
      </NuxtLink>
    </nav>
    <NuxtPage />
  </div>
</template>
