<script setup lang="ts">
import type { Language } from '@raseel/shared'
import type { CurrentUser } from '~/stores/auth'

definePageMeta({ layout: 'auth' })

const { t, locale, setLocale } = useI18n()
useHead({ title: () => t('setup.title') })

const api = useApi()
const toMessage = useApiError()
const auth = useAuthStore()

const COMMON_ZONES = [
  'Asia/Riyadh',
  'Asia/Dubai',
  'Asia/Kuwait',
  'Asia/Qatar',
  'Asia/Bahrain',
  'Asia/Muscat',
  'Africa/Cairo',
  'Africa/Khartoum',
  'Asia/Amman',
  'Europe/London',
]
const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone
const zones = computed(() => [...new Set([browserZone, ...COMMON_ZONES])].filter(Boolean))

const step = ref<1 | 2>(1)
const busy = ref(false)
const error = ref<string | null>(null)

const form = reactive({
  business: {
    name: '',
    language: locale.value as Language,
    timeZone: COMMON_ZONES.includes(browserZone) ? browserZone : 'Asia/Riyadh',
  },
  owner: { name: '', email: '', password: '' },
})

watch(
  () => form.business.language,
  (lang) => void setLocale(lang),
)

async function submit() {
  if (step.value === 1) {
    step.value = 2
    return
  }
  busy.value = true
  error.value = null
  try {
    const res = await api<{ user: CurrentUser }>('/setup', { method: 'POST', body: form })
    auth.setUser(res.user)
    await auth.loadSetupStatus(true)
    await navigateTo('/inbox')
  } catch (err) {
    error.value = toMessage(err)
    if (apiErrorCode(err) === 'already_setup') {
      await auth.loadSetupStatus(true)
      await navigateTo('/login')
    }
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="w-full max-w-md">
    <div class="mb-6 text-center">
      <h1 class="text-2xl font-bold">{{ $t('setup.title') }}</h1>
      <p class="mt-1.5 text-slate-600 dark:text-slate-400">{{ $t('setup.subtitle') }}</p>
    </div>

    <ol class="mb-4 flex gap-2 text-sm">
      <li
        v-for="(label, i) in [$t('setup.stepBusiness'), $t('setup.stepOwner')]"
        :key="label"
        class="flex flex-1 items-center gap-2 rounded-xl px-3 py-2"
        :class="step === i + 1 ? 'bg-brand-700 text-white' : 'bg-white text-slate-500 dark:bg-slate-900'"
      >
        <span class="grid size-5 place-items-center rounded-full bg-white/20 text-xs font-bold">{{ i + 1 }}</span>
        {{ label }}
      </li>
    </ol>

    <form class="card space-y-4 p-6" @submit.prevent="submit">
      <template v-if="step === 1">
        <div>
          <label class="label" for="biz-name">{{ $t('setup.businessName') }}</label>
          <input
            id="biz-name"
            v-model="form.business.name"
            class="input"
            required
            maxlength="120"
            autofocus
            :placeholder="$t('setup.businessNamePlaceholder')"
          >
        </div>
        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class="label" for="biz-lang">{{ $t('setup.defaultLanguage') }}</label>
            <select id="biz-lang" v-model="form.business.language" class="input">
              <option value="ar">العربية</option>
              <option value="en">English</option>
            </select>
          </div>
          <div>
            <label class="label" for="biz-tz">{{ $t('setup.timeZone') }}</label>
            <select id="biz-tz" v-model="form.business.timeZone" class="input ltr">
              <option v-for="z in zones" :key="z" :value="z">{{ z }}</option>
            </select>
          </div>
        </div>
        <button type="submit" class="btn-primary w-full">{{ $t('common.next') }}</button>
      </template>

      <template v-else>
        <div>
          <label class="label" for="owner-name">{{ $t('setup.ownerName') }}</label>
          <input id="owner-name" v-model="form.owner.name" class="input" required maxlength="120" autofocus>
        </div>
        <div>
          <label class="label" for="owner-email">{{ $t('common.email') }}</label>
          <input id="owner-email" v-model="form.owner.email" type="email" class="input ltr" required autocomplete="email">
        </div>
        <div>
          <label class="label" for="owner-pass">{{ $t('common.password') }}</label>
          <input
            id="owner-pass"
            v-model="form.owner.password"
            type="password"
            class="input ltr"
            required
            minlength="10"
            maxlength="128"
            autocomplete="new-password"
          >
          <p class="mt-1 text-xs text-slate-500">{{ $t('setup.passwordHint') }}</p>
        </div>
        <FormAlert :message="error" />
        <div class="flex gap-3">
          <button type="button" class="btn-secondary" @click="step = 1">{{ $t('common.back') }}</button>
          <button type="submit" class="btn-primary flex-1" :disabled="busy">
            {{ busy ? $t('common.loading') : $t('setup.finish') }}
          </button>
        </div>
      </template>
    </form>
  </div>
</template>
