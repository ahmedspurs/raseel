<script setup lang="ts">
import {
  CheckSquare,
  Columns3,
  Languages,
  LogOut,
  Megaphone,
  MessageCircle,
  Settings,
  Users,
} from 'lucide-vue-next'
import type { Component } from 'vue'

const auth = useAuthStore()
const route = useRoute()
const realtime = useRealtime()
const { t, locale, locales, setLocale } = useI18n()
const api = useApi()

const toast = ref<{ text: string; to: string } | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | undefined
realtime.on<{ taskId: string; title: string }>('task', (e) => {
  toast.value = { text: t('tasks.dueToast', { title: e.title }), to: '/tasks' }
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = null), 8000)
})

interface NavItem {
  to: string
  label: string
  icon: Component
}
const nav: NavItem[] = [
  { to: '/inbox', label: 'nav.inbox', icon: MessageCircle },
  { to: '/contacts', label: 'nav.contacts', icon: Users },
  { to: '/deals', label: 'nav.deals', icon: Columns3 },
  { to: '/broadcasts', label: 'nav.broadcasts', icon: Megaphone },
  { to: '/tasks', label: 'nav.tasks', icon: CheckSquare },
]
const isActive = (to: string) => route.path.startsWith(to)

const initials = computed(() =>
  (auth.user?.name ?? '?')
    .split(/\s+/)
    .map((p) => [...p][0])
    .slice(0, 2)
    .join(''),
)

const menuOpen = ref(false)
const menu = ref<HTMLElement | null>(null)
function onDocClick(e: MouseEvent) {
  if (menuOpen.value && menu.value && !menu.value.contains(e.target as Node)) menuOpen.value = false
}
onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))

const otherLocale = computed(() => locales.value.find((l) => l.code !== locale.value))
async function switchLanguage() {
  const next = otherLocale.value?.code
  if (!next) return
  await setLocale(next)
  const res = await api<{ user: typeof auth.user }>('/auth/me', {
    method: 'PATCH',
    body: { language: next },
  }).catch(() => null)
  if (res?.user) auth.setUser(res.user)
}

async function logout() {
  await auth.logout()
  await navigateTo('/login')
}
</script>

<template>
  <div class="flex min-h-dvh flex-col md:flex-row">
    <!-- Desktop: narrow ink rail. Mobile: bottom tab bar. -->
    <nav
      :aria-label="$t('app.name')"
      class="fixed inset-x-0 bottom-0 z-30 flex h-[4.5rem] items-stretch justify-around border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:static md:h-auto md:w-16 md:flex-col md:items-center md:justify-start md:gap-1 md:border-0 md:bg-slate-900 md:py-4"
    >
      <NuxtLink to="/inbox" class="mb-5 hidden md:block" :aria-label="$t('app.name')">
        <RaseelLogo :size="32" inverted />
      </NuxtLink>

      <NuxtLink
        v-for="item in nav"
        :key="item.to"
        :to="item.to"
        :title="$t(item.label)"
        :aria-current="isActive(item.to) ? 'page' : undefined"
        class="flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium md:size-11 md:flex-none md:rounded-xl"
        :class="
          isActive(item.to)
            ? 'text-slate-900 md:bg-slate-800 md:text-white'
            : 'text-slate-500 hover:text-slate-900 md:text-slate-400 md:hover:bg-slate-800 md:hover:text-white'
        "
      >
        <component :is="item.icon" class="size-5" :stroke-width="1.5" aria-hidden="true" />
        <span class="md:sr-only">{{ $t(item.label) }}</span>
      </NuxtLink>

      <div class="hidden flex-1 md:block" />

      <MentionsBell class="hidden md:block" variant="rail" />

      <NuxtLink
        to="/settings"
        :title="$t('nav.settings')"
        :aria-current="isActive('/settings') ? 'page' : undefined"
        class="flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium md:size-11 md:flex-none md:rounded-xl"
        :class="
          isActive('/settings')
            ? 'text-slate-900 md:bg-slate-800 md:text-white'
            : 'text-slate-500 hover:text-slate-900 md:text-slate-400 md:hover:bg-slate-800 md:hover:text-white'
        "
      >
        <Settings class="size-5" :stroke-width="1.5" aria-hidden="true" />
        <span class="md:sr-only">{{ $t('nav.settings') }}</span>
      </NuxtLink>

      <div ref="menu" class="relative hidden md:mt-2 md:block">
        <button
          type="button"
          class="grid size-9 place-items-center rounded-full bg-slate-700 text-[13px] font-semibold text-white hover:bg-slate-600"
          :aria-label="$t('inbox.account')"
          :aria-expanded="menuOpen"
          @click="menuOpen = !menuOpen"
        >
          {{ initials }}
        </button>
        <div
          v-if="menuOpen"
          class="card absolute bottom-0 start-full z-40 ms-3 w-60 p-1.5 shadow-lg"
          role="menu"
        >
          <div class="border-b border-slate-200 px-3 py-2.5">
            <p class="truncate text-sm font-semibold">{{ auth.user?.name }}</p>
            <p class="truncate text-xs text-slate-500">
              {{ auth.user && $t(`roles.${auth.user.role}`) }} ·
              <span class="ltr">{{ auth.user?.email }}</span>
            </p>
          </div>
          <button
            v-if="otherLocale"
            type="button"
            role="menuitem"
            class="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
            @click="switchLanguage"
          >
            <Languages class="size-4" :stroke-width="1.5" aria-hidden="true" />
            {{ otherLocale.name }}
          </button>
          <button
            type="button"
            role="menuitem"
            class="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
            @click="logout"
          >
            <LogOut class="size-4 rtl:-scale-x-100" :stroke-width="1.5" aria-hidden="true" />
            {{ $t('nav.logout') }}
          </button>
        </div>
      </div>
    </nav>

    <main class="min-w-0 flex-1 pb-[4.5rem] md:pb-0">
      <slot />
    </main>

    <NuxtLink
      v-if="toast"
      :to="toast.to"
      role="status"
      class="fixed bottom-24 end-4 z-50 flex max-w-sm items-center gap-3 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-lg md:bottom-6"
      @click="toast = null"
    >
      <span class="dot bg-amber-400" aria-hidden="true" />
      {{ toast.text }}
    </NuxtLink>
  </div>
</template>
