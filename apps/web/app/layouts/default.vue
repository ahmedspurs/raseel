<script setup lang="ts">
const auth = useAuthStore()
const route = useRoute()

const nav = computed(() => [
  { to: '/inbox', label: 'nav.inbox', icon: 'M4 5h16v10h-5l-3 3-3-3H4z' },
  {
    to: '/settings',
    label: 'nav.settings',
    icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.3l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2.2-1.3L14.4 3h-4l-.4 2.4a7.5 7.5 0 0 0-2.2 1.3l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.6l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 2.2 1.3l.4 2.4h4l.4-2.4a7.5 7.5 0 0 0 2.2-1.3l2.4 1 2-3.4-2-1.6c.1-.4.1-.9.1-1.3Z',
  },
])

const initials = computed(() =>
  (auth.user?.name ?? '?')
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join(''),
)

async function logout() {
  await auth.logout()
  await navigateTo('/login')
}
</script>

<template>
  <div class="flex min-h-dvh flex-col md:flex-row">
    <aside
      class="order-last flex shrink-0 border-t border-slate-200 bg-white md:order-first md:w-60 md:flex-col md:border-e md:border-t-0 dark:border-slate-800 dark:bg-slate-900"
    >
      <div class="hidden items-center gap-2.5 px-5 py-5 md:flex">
        <img src="/icon.svg" alt="" class="size-8" />
        <span class="text-lg font-bold text-brand-800 dark:text-brand-200">{{
          $t('app.name')
        }}</span>
      </div>
      <nav class="flex flex-1 justify-around gap-1 p-2 md:flex-col md:justify-start md:px-3">
        <NuxtLink
          v-for="item in nav"
          :key="item.to"
          :to="item.to"
          class="flex flex-col items-center gap-1 rounded-xl px-3 py-2 text-xs font-medium md:flex-row md:gap-3 md:text-sm"
          :class="
            route.path.startsWith(item.to)
              ? 'bg-brand-50 text-brand-800 dark:bg-brand-900/40 dark:text-brand-100'
              : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
          "
        >
          <svg
            viewBox="0 0 24 24"
            class="size-5"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linejoin="round"
          >
            <path :d="item.icon" />
          </svg>
          {{ $t(item.label) }}
        </NuxtLink>
      </nav>
      <div class="hidden border-t border-slate-200 p-3 md:block dark:border-slate-800">
        <div class="flex items-center gap-3 px-2 py-2">
          <span
            class="grid size-9 place-items-center rounded-full bg-brand-100 text-sm font-semibold text-brand-800"
          >
            {{ initials }}
          </span>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium">{{ auth.user?.name }}</p>
            <p class="text-xs text-slate-500">{{ auth.user && $t(`roles.${auth.user.role}`) }}</p>
          </div>
        </div>
        <div class="mt-1 flex items-center justify-between">
          <LanguageSwitcher />
          <button
            type="button"
            class="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            @click="logout"
          >
            {{ $t('nav.logout') }}
          </button>
        </div>
      </div>
    </aside>
    <main class="min-w-0 flex-1">
      <slot />
    </main>
  </div>
</template>
