<script setup lang="ts">
import type { Role } from '@raseel/shared'
import type { CurrentUser } from '~/stores/auth'

definePageMeta({ layout: 'auth' })

const { t } = useI18n()
useHead({ title: () => t('invite.title') })

const api = useApi()
const toMessage = useApiError()
const auth = useAuthStore()
const route = useRoute()
const token = computed(() => String(route.params.token))

const { data: invite, error: loadError } = await useAsyncData(`invite-${token.value}`, () =>
  api<{ email: string; name: string; role: Role }>(`/auth/invitations/${token.value}`),
)

const password = ref('')
const busy = ref(false)
const error = ref<string | null>(null)

async function submit() {
  busy.value = true
  error.value = null
  try {
    const res = await api<{ user: CurrentUser }>('/auth/invitations/accept', {
      method: 'POST',
      body: { token: token.value, password: password.value },
    })
    auth.setUser(res.user)
    await navigateTo('/inbox')
  } catch (err) {
    error.value = toMessage(err)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="w-full max-w-sm">
    <div v-if="loadError" class="card p-6 text-center">
      <FormAlert :message="$t('errors.invalid_invitation')" />
      <NuxtLink to="/login" class="btn-secondary mt-4">{{ $t('login.title') }}</NuxtLink>
    </div>
    <template v-else-if="invite">
      <div class="mb-6 text-center">
        <h1 class="text-2xl font-bold">{{ $t('invite.title') }}</h1>
        <p class="mt-1.5 text-slate-600 dark:text-slate-400">
          {{ $t('invite.subtitle', { role: $t(`roles.${invite.role}`) }) }}
        </p>
      </div>
      <form class="card space-y-4 p-6" @submit.prevent="submit">
        <div>
          <label class="label">{{ $t('common.name') }}</label>
          <input :value="invite.name" class="input" disabled />
        </div>
        <div>
          <label class="label">{{ $t('common.email') }}</label>
          <input :value="invite.email" class="input ltr" disabled />
        </div>
        <div>
          <label class="label" for="password">{{ $t('common.password') }}</label>
          <input
            id="password"
            v-model="password"
            type="password"
            class="input ltr"
            required
            minlength="10"
            maxlength="128"
            autocomplete="new-password"
            autofocus
          />
          <p class="mt-1 text-xs text-slate-500">{{ $t('setup.passwordHint') }}</p>
        </div>
        <FormAlert :message="error" />
        <button type="submit" class="btn-primary w-full" :disabled="busy">
          {{ busy ? $t('common.loading') : $t('invite.submit') }}
        </button>
      </form>
    </template>
  </div>
</template>
