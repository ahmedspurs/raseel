<script setup lang="ts">
import type { Language } from '@raseel/shared'
import type { CurrentUser } from '~/stores/auth'

const api = useApi()
const toMessage = useApiError()
const auth = useAuthStore()
const { t, setLocale } = useI18n()

const form = reactive({
  name: auth.user?.name ?? '',
  language: (auth.user?.language ?? 'ar') as Language,
})
const busy = ref(false)
const message = ref<{ text: string; tone: 'error' | 'success' } | null>(null)

async function save() {
  busy.value = true
  message.value = null
  try {
    const res = await api<{ user: CurrentUser }>('/auth/me', { method: 'PATCH', body: form })
    auth.setUser(res.user)
    await setLocale(res.user.language)
    message.value = { text: t('common.saved'), tone: 'success' }
  } catch (err) {
    message.value = { text: toMessage(err), tone: 'error' }
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <form class="card max-w-xl space-y-4 p-6" @submit.prevent="save">
    <div>
      <label class="label" for="name">{{ $t('common.name') }}</label>
      <input id="name" v-model="form.name" class="input" required maxlength="120" />
    </div>
    <div>
      <label class="label">{{ $t('common.email') }}</label>
      <input :value="auth.user?.email" class="input ltr" disabled />
    </div>
    <div>
      <label class="label" for="lang">{{ $t('common.language') }}</label>
      <select id="lang" v-model="form.language" class="input">
        <option value="ar">العربية</option>
        <option value="en">English</option>
      </select>
    </div>
    <FormAlert :message="message?.text" :tone="message?.tone" />
    <button type="submit" class="btn-primary" :disabled="busy">{{ $t('common.save') }}</button>
  </form>
</template>
