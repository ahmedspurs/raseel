<script setup lang="ts">
import type { BusinessSettings } from '@raseel/shared'

const api = useApi()
const toMessage = useApiError()
const { t } = useI18n()
const auth = useAuthStore()

const { data } = await useAsyncData('business', () =>
  api<{ business: BusinessSettings | null }>('/settings/business'),
)

const form = reactive<BusinessSettings>({
  name: data.value?.business?.name ?? '',
  language: data.value?.business?.language ?? 'ar',
  timeZone: data.value?.business?.timeZone ?? 'Asia/Riyadh',
  logoUrl: data.value?.business?.logoUrl ?? null,
})
const busy = ref(false)
const message = ref<{ text: string; tone: 'error' | 'success' } | null>(null)

async function save() {
  busy.value = true
  message.value = null
  try {
    await api('/settings/business', { method: 'PUT', body: { ...form, logoUrl: form.logoUrl || null } })
    await auth.loadSetupStatus(true)
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
      <label class="label" for="name">{{ $t('setup.businessName') }}</label>
      <input id="name" v-model="form.name" class="input" required maxlength="120">
    </div>
    <div class="grid gap-4 sm:grid-cols-2">
      <div>
        <label class="label" for="lang">{{ $t('setup.defaultLanguage') }}</label>
        <select id="lang" v-model="form.language" class="input">
          <option value="ar">العربية</option>
          <option value="en">English</option>
        </select>
      </div>
      <div>
        <label class="label" for="tz">{{ $t('setup.timeZone') }}</label>
        <input id="tz" v-model="form.timeZone" class="input ltr" required>
      </div>
    </div>
    <FormAlert :message="message?.text" :tone="message?.tone" />
    <button type="submit" class="btn-primary" :disabled="busy">{{ $t('common.save') }}</button>
  </form>
</template>
