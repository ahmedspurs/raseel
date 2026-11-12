<script setup lang="ts">
const { locale, locales, setLocale } = useI18n()
const auth = useAuthStore()
const api = useApi()

const other = computed(() => locales.value.find((l) => l.code !== locale.value))

async function toggle() {
  const next = other.value?.code
  if (!next) return
  await setLocale(next)
  if (auth.user) {
    const res = await api<{ user: typeof auth.user }>('/auth/me', {
      method: 'PATCH',
      body: { language: next },
    }).catch(() => null)
    if (res?.user) auth.setUser(res.user)
  }
}
</script>

<template>
  <button
    v-if="other"
    type="button"
    class="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-white/70 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
    :lang="other.code"
    @click="toggle"
  >
    {{ other.name }}
  </button>
</template>
