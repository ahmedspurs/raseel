<script setup lang="ts">
import { Languages, LogOut } from 'lucide-vue-next'
import type { Permission } from '@raseel/shared'

const { t } = useI18n()
useHead({ title: () => t('settings.title') })
const auth = useAuthStore()
const { locale, locales, setLocale } = useI18n()
const otherLocale = computed(() => locales.value.find((l) => l.code !== locale.value))
async function logout() {
  await auth.logout()
  await navigateTo('/login')
}

const tabs = computed(() =>
  (
    [
      { to: '/settings/profile', label: 'settings.profile' },
      { to: '/settings/security', label: 'settings.security' },
      { to: '/settings/business', label: 'settings.business', permission: 'settings:manage' },
      { to: '/settings/whatsapp', label: 'settings.whatsapp', permission: 'whatsapp:manage' },
      { to: '/settings/inbox', label: 'settings.inbox', permission: 'settings:manage' },
      {
        to: '/settings/quick-replies',
        label: 'settings.quickReplies',
        permission: 'templates:manage',
      },
      { to: '/settings/users', label: 'settings.users', permission: 'users:manage' },
      { to: '/settings/teams', label: 'settings.teams', permission: 'teams:manage' },
      { to: '/settings/templates', label: 'settings.templates', permission: 'templates:manage' },
      { to: '/settings/tags', label: 'settings.tags', permission: 'tags:manage' },
      {
        to: '/settings/custom-fields',
        label: 'settings.customFields',
        permission: 'settings:manage',
      },
      {
        to: '/settings/automation',
        label: 'settings.automation',
        permission: 'automations:manage',
      },
      { to: '/settings/segments', label: 'settings.segments', permission: 'broadcasts:manage' },
      { to: '/settings/pipeline', label: 'settings.pipeline', permission: 'settings:manage' },
    ] as { to: string; label: string; permission?: Permission }[]
  ).filter((tab) => !tab.permission || auth.can(tab.permission)),
)
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-10">
    <div class="mb-6 flex items-center justify-between gap-3">
      <h1 class="text-2xl font-bold">{{ $t('settings.title') }}</h1>
      <!-- On phones the rail is replaced by a tab bar, so account actions live here. -->
      <div class="flex items-center gap-1 md:hidden">
        <button
          v-if="otherLocale"
          type="button"
          class="btn-ghost min-h-9 text-[13px]"
          @click="setLocale(otherLocale.code)"
        >
          <Languages class="size-4" :stroke-width="1.5" aria-hidden="true" />{{ otherLocale.name }}
        </button>
        <button type="button" class="btn-ghost min-h-9 text-[13px]" @click="logout">
          <LogOut class="size-4 rtl:-scale-x-100" :stroke-width="1.5" aria-hidden="true" />{{
            $t('nav.logout')
          }}
        </button>
      </div>
    </div>

    <div class="flex flex-col gap-6 lg:flex-row lg:gap-10">
      <nav
        :aria-label="$t('settings.title')"
        class="-mx-4 flex shrink-0 gap-1 overflow-x-auto border-b border-slate-200 px-4 lg:mx-0 lg:w-52 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:border-0 lg:px-0"
      >
        <NuxtLink
          v-for="tab in tabs"
          :key="tab.to"
          :to="tab.to"
          class="-mb-px whitespace-nowrap border-b-2 border-transparent px-3 py-2.5 text-sm text-slate-600 hover:text-slate-900 lg:mb-0 lg:rounded-lg lg:border-0 lg:py-2 lg:hover:bg-slate-100"
          active-class="!border-slate-900 font-semibold !text-slate-900 lg:!bg-white lg:shadow-sm lg:ring-1 lg:ring-slate-200"
        >
          {{ $t(tab.label) }}
        </NuxtLink>
      </nav>
      <div class="min-w-0 flex-1">
        <NuxtPage />
      </div>
    </div>
  </div>
</template>
