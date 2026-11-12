<script setup lang="ts">
import type { CurrentUser } from '~/stores/auth'

definePageMeta({ layout: 'auth' })

const { t } = useI18n()
useHead({ title: () => t('login.title') })

const api = useApi()
const toMessage = useApiError()
const auth = useAuthStore()
const route = useRoute()

const form = reactive({ email: '', password: '', totp: '' })
const needsTotp = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)

const businessName = computed(() => auth.setup?.business?.name ?? t('app.name'))

async function submit() {
  busy.value = true
  error.value = null
  try {
    const res = await api<{ user: CurrentUser }>('/auth/login', {
      method: 'POST',
      body: { email: form.email, password: form.password, totp: form.totp || undefined },
    })
    auth.setUser(res.user)
    const next =
      typeof route.query.next === 'string' && route.query.next.startsWith('/')
        ? route.query.next
        : '/inbox'
    await navigateTo(next)
  } catch (err) {
    const code = apiErrorCode(err)
    if (code === 'totp_required') {
      needsTotp.value = true
      error.value = null
    } else {
      error.value = toMessage(err)
    }
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="w-full max-w-sm">
    <div class="mb-6 text-center">
      <h1 class="text-2xl font-bold">{{ $t('login.title') }}</h1>
      <p class="mt-1.5 text-slate-600 dark:text-slate-400">
        {{ $t('login.subtitle', { name: businessName }) }}
      </p>
    </div>
    <form class="card space-y-4 p-6" @submit.prevent="submit">
      <div>
        <label class="label" for="email">{{ $t('common.email') }}</label>
        <input
          id="email"
          v-model="form.email"
          type="email"
          class="input ltr"
          required
          autocomplete="username"
          autofocus
        />
      </div>
      <div>
        <label class="label" for="password">{{ $t('common.password') }}</label>
        <input
          id="password"
          v-model="form.password"
          type="password"
          class="input ltr"
          required
          autocomplete="current-password"
        />
      </div>
      <div v-if="needsTotp">
        <label class="label" for="totp">{{ $t('login.totp') }}</label>
        <input
          id="totp"
          v-model="form.totp"
          class="input ltr text-center text-lg tracking-[0.5em]"
          inputmode="numeric"
          pattern="\d{6}"
          maxlength="6"
          autocomplete="one-time-code"
          required
          autofocus
        />
        <p class="mt-1 text-xs text-slate-500">{{ $t('errors.totp_required') }}</p>
      </div>
      <FormAlert :message="error" />
      <button type="submit" class="btn-primary w-full" :disabled="busy">
        {{ busy ? $t('common.loading') : $t('login.submit') }}
      </button>
    </form>
  </div>
</template>
