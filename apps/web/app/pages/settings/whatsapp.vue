<script setup lang="ts">
definePageMeta({
  middleware: [() => (useAuthStore().can('whatsapp:manage') ? undefined : navigateTo('/settings'))],
})

interface WhatsAppSettings {
  connected: boolean
  phoneNumberId: string | null
  wabaId: string | null
  accessToken: string | null
  appSecretSet: boolean
  phone: { displayPhoneNumber: string; verifiedName: string; qualityRating: string | null } | null
  webhook: { url: string; verifyToken: string; firstReceivedAt: string | null }
}

const api = useApi()
const toMessage = useApiError()
const { t, locale } = useI18n()

const { data, refresh } = await useAsyncData('whatsapp-settings', () =>
  api<WhatsAppSettings>('/whatsapp/settings'),
)

const form = reactive({
  phoneNumberId: data.value?.phoneNumberId ?? '',
  wabaId: data.value?.wabaId ?? '',
  accessToken: '',
  appSecret: '',
})
const busy = ref(false)
const message = ref<{ text: string; tone: 'error' | 'success' } | null>(null)
const confirmingDisconnect = ref(false)

const dateFmt = computed(
  () => new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }),
)

// Poll until Meta's first webhook arrives so the owner sees setup succeed (FR-03).
let timer: ReturnType<typeof setInterval> | undefined
watchEffect(() => {
  clearInterval(timer)
  if (data.value?.connected && !data.value.webhook.firstReceivedAt) {
    timer = setInterval(() => void refresh(), 5000)
  }
})
onBeforeUnmount(() => clearInterval(timer))

async function save() {
  busy.value = true
  message.value = null
  try {
    await api('/whatsapp/settings', {
      method: 'PUT',
      body: {
        phoneNumberId: form.phoneNumberId.trim(),
        wabaId: form.wabaId.trim(),
        accessToken: form.accessToken.trim() || undefined,
        appSecret: form.appSecret.trim() || undefined,
      },
    })
    form.accessToken = ''
    form.appSecret = ''
    await refresh()
    message.value = { text: t('common.saved'), tone: 'success' }
  } catch (err) {
    const detail = (err as { data?: { error?: string; detail?: { message?: string } } }).data
    message.value = {
      tone: 'error',
      text:
        detail?.error === 'whatsapp_verification_failed'
          ? t('whatsapp.verificationFailed', { reason: detail.detail?.message ?? '—' })
          : toMessage(err),
    }
  } finally {
    busy.value = false
  }
}

async function disconnect() {
  await api('/whatsapp/settings', { method: 'DELETE' })
  confirmingDisconnect.value = false
  form.accessToken = ''
  form.appSecret = ''
  await refresh()
}
</script>

<template>
  <div v-if="data" class="space-y-6">
    <section class="card flex flex-wrap items-center gap-4 p-5">
      <span
        class="grid size-11 place-items-center rounded-xl"
        :class="data.connected ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'"
      >
        <svg viewBox="0 0 24 24" class="size-6" fill="currentColor" aria-hidden="true">
          <path
            d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4c1.7.7 2.4.8 3.2.7.5-.1 1.5-.6 1.8-1.2.2-.6.2-1.1.1-1.2l-.4-.2Z"
          />
        </svg>
      </span>
      <div class="min-w-0 flex-1">
        <p class="font-semibold">
          {{ data.connected ? data.phone?.verifiedName : $t('whatsapp.connectTitle') }}
        </p>
        <p v-if="data.connected" class="ltr text-sm text-slate-600 dark:text-slate-400">
          {{ data.phone?.displayPhoneNumber }}
        </p>
        <p v-else class="text-sm text-slate-600 dark:text-slate-400">
          {{ $t('whatsapp.connectIntro') }}
        </p>
      </div>
      <div class="flex items-center gap-2">
        <span
          v-if="data.connected && data.phone?.qualityRating"
          class="badge bg-slate-100 text-slate-700"
          :title="$t('whatsapp.quality')"
        >
          {{ data.phone.qualityRating }}
        </span>
        <span
          class="badge"
          :class="
            data.connected ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
          "
        >
          {{ data.connected ? $t('whatsapp.connected') : $t('whatsapp.notConnected') }}
        </span>
      </div>
    </section>

    <form class="card space-y-4 p-6" @submit.prevent="save">
      <div class="grid gap-4 sm:grid-cols-2">
        <div>
          <label class="label" for="pnid">{{ $t('whatsapp.phoneNumberId') }}</label>
          <input
            id="pnid"
            v-model="form.phoneNumberId"
            class="input ltr font-mono"
            inputmode="numeric"
            required
            autocomplete="off"
          />
        </div>
        <div>
          <label class="label" for="waba">{{ $t('whatsapp.wabaId') }}</label>
          <input
            id="waba"
            v-model="form.wabaId"
            class="input ltr font-mono"
            inputmode="numeric"
            required
            autocomplete="off"
          />
        </div>
      </div>
      <div>
        <label class="label" for="token">{{ $t('whatsapp.accessToken') }}</label>
        <input
          id="token"
          v-model="form.accessToken"
          type="password"
          class="input ltr font-mono"
          :required="!data.connected"
          autocomplete="off"
        />
        <p class="mt-1 text-xs text-slate-500">
          {{
            data.connected
              ? $t('whatsapp.accessTokenKeep', { masked: data.accessToken })
              : $t('whatsapp.accessTokenHint')
          }}
        </p>
      </div>
      <div>
        <label class="label" for="secret">{{ $t('whatsapp.appSecret') }}</label>
        <input
          id="secret"
          v-model="form.appSecret"
          type="password"
          class="input ltr font-mono"
          :required="!data.appSecretSet"
          autocomplete="off"
        />
        <p class="mt-1 text-xs text-slate-500">
          {{ data.appSecretSet ? $t('whatsapp.appSecretKeep') : $t('whatsapp.appSecretHint') }}
        </p>
      </div>
      <FormAlert :message="message?.text" :tone="message?.tone" />
      <div class="flex flex-wrap items-center gap-3">
        <button type="submit" class="btn-primary" :disabled="busy">
          {{
            busy
              ? $t('common.loading')
              : data.connected
                ? $t('whatsapp.update')
                : $t('whatsapp.connect')
          }}
        </button>
        <template v-if="data.connected">
          <button
            v-if="!confirmingDisconnect"
            type="button"
            class="btn-secondary"
            @click="confirmingDisconnect = true"
          >
            {{ $t('whatsapp.disconnect') }}
          </button>
          <span v-else class="flex flex-wrap items-center gap-2 text-sm">
            {{ $t('whatsapp.disconnectConfirm') }}
            <button type="button" class="btn-danger" @click="disconnect">
              {{ $t('whatsapp.disconnect') }}
            </button>
            <button type="button" class="btn-secondary" @click="confirmingDisconnect = false">
              {{ $t('common.cancel') }}
            </button>
          </span>
        </template>
      </div>
      <p class="text-xs text-slate-500">{{ $t('whatsapp.billingNote') }}</p>
    </form>

    <section class="card space-y-4 p-6">
      <div>
        <h2 class="text-lg font-semibold">{{ $t('whatsapp.webhookTitle') }}</h2>
        <p class="mt-1 text-sm text-slate-600 dark:text-slate-400">
          {{ $t('whatsapp.webhookIntro') }}
        </p>
      </div>
      <CopyField id="cb-url" :label="$t('whatsapp.callbackUrl')" :value="data.webhook.url" />
      <CopyField
        id="verify-token"
        :label="$t('whatsapp.verifyToken')"
        :value="data.webhook.verifyToken"
      />
      <FormAlert
        v-if="data.connected"
        :tone="data.webhook.firstReceivedAt ? 'success' : 'info'"
        :message="
          data.webhook.firstReceivedAt
            ? $t('whatsapp.webhookReceived', {
                date: dateFmt.format(new Date(data.webhook.firstReceivedAt)),
              })
            : $t('whatsapp.webhookWaiting')
        "
      />
    </section>
  </div>
</template>
