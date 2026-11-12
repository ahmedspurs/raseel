<script setup lang="ts">
import type { InboxSettings } from '@raseel/shared'

definePageMeta({
  middleware: [() => (useAuthStore().can('settings:manage') ? undefined : navigateTo('/settings'))],
})

const api = useApi()
const toMessage = useApiError()
const { t } = useI18n()
const directory = useDirectoryStore()

const { data } = await useAsyncData('inbox-settings', () =>
  api<{ inbox: InboxSettings }>('/settings/inbox').then((r) => r.inbox),
)
await directory.load()

const form = reactive<InboxSettings>({
  autoAssign: {
    enabled: data.value?.autoAssign.enabled ?? false,
    userIds: [...(data.value?.autoAssign.userIds ?? [])],
  },
})
const busy = ref(false)
const message = ref<{ text: string; tone: 'error' | 'success' } | null>(null)

async function save() {
  busy.value = true
  message.value = null
  try {
    await api('/settings/inbox', { method: 'PUT', body: form })
    message.value = { text: t('common.saved'), tone: 'success' }
  } catch (err) {
    message.value = { text: toMessage(err), tone: 'error' }
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <form class="card max-w-2xl space-y-5 p-6" @submit.prevent="save">
    <label class="flex items-start gap-3">
      <input
        v-model="form.autoAssign.enabled"
        type="checkbox"
        class="mt-1 size-4 accent-brand-700"
      />
      <span>
        <span class="font-semibold">{{ $t('inboxSettings.autoAssign') }}</span>
        <span class="block text-sm text-slate-600 dark:text-slate-400">{{
          $t('inboxSettings.autoAssignHelp')
        }}</span>
      </span>
    </label>

    <fieldset v-if="form.autoAssign.enabled">
      <legend class="label">{{ $t('inboxSettings.participants') }}</legend>
      <p class="mb-2 text-xs text-slate-500">{{ $t('inboxSettings.participantsHelp') }}</p>
      <div class="grid gap-2 sm:grid-cols-2">
        <label
          v-for="u in directory.assignable"
          :key="u.id"
          class="flex items-center gap-2.5 rounded-xl border border-slate-200 px-3 py-2 text-sm dark:border-slate-800"
        >
          <input
            v-model="form.autoAssign.userIds"
            type="checkbox"
            :value="u.id"
            class="size-4 accent-brand-700"
          />
          <span class="flex-1">{{ u.name }}</span>
          <span class="text-xs text-slate-500">{{ $t(`roles.${u.role}`) }}</span>
        </label>
      </div>
    </fieldset>

    <FormAlert :message="message?.text" :tone="message?.tone" />
    <button type="submit" class="btn-primary" :disabled="busy">{{ $t('common.save') }}</button>
  </form>
</template>
