<script setup lang="ts">
const api = useApi()
const toMessage = useApiError()
const auth = useAuthStore()
const { t } = useI18n()

// ── Password ──
const pw = reactive({ currentPassword: '', newPassword: '' })
const pwBusy = ref(false)
const pwMessage = ref<{ text: string; tone: 'error' | 'success' } | null>(null)

async function changePassword() {
  pwBusy.value = true
  pwMessage.value = null
  try {
    await api('/auth/me/password', { method: 'POST', body: pw })
    pw.currentPassword = ''
    pw.newPassword = ''
    pwMessage.value = { text: t('settings.passwordChanged'), tone: 'success' }
  } catch (err) {
    pwMessage.value = { text: toMessage(err), tone: 'error' }
  } finally {
    pwBusy.value = false
  }
}

// ── Two-factor ──
const pending = ref<{ secret: string; uri: string } | null>(null)
const totp = ref('')
const disablePassword = ref('')
const tfBusy = ref(false)
const tfError = ref<string | null>(null)
const copied = ref(false)

async function startTwoFactor() {
  tfError.value = null
  try {
    pending.value = await api<{ secret: string; uri: string }>('/auth/2fa/setup', {
      method: 'POST',
    })
  } catch (err) {
    tfError.value = toMessage(err)
  }
}

async function confirmTwoFactor() {
  tfBusy.value = true
  tfError.value = null
  try {
    await api('/auth/2fa/enable', { method: 'POST', body: { token: totp.value } })
    pending.value = null
    totp.value = ''
    await auth.fetchMe()
  } catch (err) {
    tfError.value = toMessage(err)
  } finally {
    tfBusy.value = false
  }
}

async function disableTwoFactor() {
  tfBusy.value = true
  tfError.value = null
  try {
    await api('/auth/2fa/disable', {
      method: 'POST',
      body: { password: disablePassword.value, token: totp.value },
    })
    disablePassword.value = ''
    totp.value = ''
    await auth.fetchMe()
  } catch (err) {
    tfError.value = toMessage(err)
  } finally {
    tfBusy.value = false
  }
}

async function copySecret() {
  if (!pending.value) return
  await navigator.clipboard.writeText(pending.value.secret)
  copied.value = true
  setTimeout(() => (copied.value = false), 2000)
}
</script>

<template>
  <div class="space-y-6">
    <form class="card max-w-xl space-y-4 p-6" @submit.prevent="changePassword">
      <h2 class="text-lg font-semibold">{{ $t('settings.changePassword') }}</h2>
      <div>
        <label class="label" for="cur">{{ $t('settings.currentPassword') }}</label>
        <input
          id="cur"
          v-model="pw.currentPassword"
          type="password"
          class="input ltr"
          required
          autocomplete="current-password"
        />
      </div>
      <div>
        <label class="label" for="new">{{ $t('settings.newPassword') }}</label>
        <input
          id="new"
          v-model="pw.newPassword"
          type="password"
          class="input ltr"
          required
          minlength="10"
          maxlength="128"
          autocomplete="new-password"
        />
        <p class="mt-1 text-xs text-slate-500">{{ $t('setup.passwordHint') }}</p>
      </div>
      <FormAlert :message="pwMessage?.text" :tone="pwMessage?.tone" />
      <button type="submit" class="btn-primary" :disabled="pwBusy">{{ $t('common.save') }}</button>
    </form>

    <section class="card max-w-xl space-y-4 p-6">
      <div class="flex items-start justify-between gap-4">
        <div>
          <h2 class="text-lg font-semibold">{{ $t('settings.twoFactor') }}</h2>
          <p class="mt-1 text-sm text-slate-600 dark:text-slate-400">
            {{
              auth.user?.twoFactorEnabled ? $t('settings.twoFactorOn') : $t('settings.twoFactorOff')
            }}
          </p>
        </div>
        <span
          class="badge"
          :class="
            auth.user?.twoFactorEnabled
              ? 'bg-emerald-100 text-emerald-800'
              : 'bg-slate-100 text-slate-600'
          "
        >
          {{ auth.user?.twoFactorEnabled ? $t('common.active') : $t('common.inactive') }}
        </span>
      </div>

      <template v-if="!auth.user?.twoFactorEnabled">
        <button v-if="!pending" type="button" class="btn-primary" @click="startTwoFactor">
          {{ $t('settings.twoFactorEnable') }}
        </button>
        <form v-else class="space-y-4" @submit.prevent="confirmTwoFactor">
          <p class="text-sm text-slate-600 dark:text-slate-400">
            {{ $t('settings.twoFactorScan') }}
          </p>
          <div>
            <label class="label">{{ $t('settings.twoFactorKey') }}</label>
            <div class="flex gap-2">
              <code class="input ltr select-all font-mono">{{ pending.secret }}</code>
              <button type="button" class="btn-secondary" @click="copySecret">
                {{ copied ? $t('common.copied') : $t('common.copy') }}
              </button>
            </div>
          </div>
          <div>
            <label class="label" for="code">{{ $t('login.totp') }}</label>
            <input
              id="code"
              v-model="totp"
              class="input ltr max-w-40 text-center tracking-[0.4em]"
              inputmode="numeric"
              pattern="\d{6}"
              maxlength="6"
              required
              autocomplete="one-time-code"
            />
          </div>
          <FormAlert :message="tfError" />
          <div class="flex gap-3">
            <button type="button" class="btn-secondary" @click="pending = null">
              {{ $t('common.cancel') }}
            </button>
            <button type="submit" class="btn-primary" :disabled="tfBusy">
              {{ $t('settings.twoFactorEnable') }}
            </button>
          </div>
        </form>
      </template>

      <form v-else class="grid gap-4 sm:grid-cols-2" @submit.prevent="disableTwoFactor">
        <div>
          <label class="label" for="dpw">{{ $t('common.password') }}</label>
          <input
            id="dpw"
            v-model="disablePassword"
            type="password"
            class="input ltr"
            required
            autocomplete="current-password"
          />
        </div>
        <div>
          <label class="label" for="dcode">{{ $t('login.totp') }}</label>
          <input
            id="dcode"
            v-model="totp"
            class="input ltr text-center tracking-[0.4em]"
            inputmode="numeric"
            pattern="\d{6}"
            maxlength="6"
            required
            autocomplete="one-time-code"
          />
        </div>
        <FormAlert class="sm:col-span-2" :message="tfError" />
        <div class="sm:col-span-2">
          <button type="submit" class="btn-danger" :disabled="tfBusy">
            {{ $t('settings.twoFactorDisable') }}
          </button>
        </div>
      </form>
    </section>
  </div>
</template>
