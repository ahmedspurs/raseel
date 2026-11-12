<script setup lang="ts">
import type { InboxMessage } from '~/types/inbox'

const props = defineProps<{ conversationId: string; disabled?: boolean }>()
const emit = defineEmits<{ sent: [message: InboxMessage] }>()

const api = useApi()
const toMessage = useApiError()

const text = ref('')
const file = ref<File | null>(null)
const busy = ref(false)
const error = ref<string | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const textarea = ref<HTMLTextAreaElement | null>(null)

const previewUrl = computed(() =>
  file.value && file.value.type.startsWith('image/') ? URL.createObjectURL(file.value) : null,
)
watch(previewUrl, (_, old) => old && URL.revokeObjectURL(old))

const canSend = computed(() => !busy.value && !props.disabled && (text.value.trim() || file.value))

function pickFile(event: Event) {
  const input = event.target as HTMLInputElement
  file.value = input.files?.[0] ?? null
  input.value = ''
}

function autoGrow() {
  const el = textarea.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 200)}px`
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    void send()
  }
}

async function send() {
  if (!canSend.value) return
  busy.value = true
  error.value = null
  try {
    let res: { message: InboxMessage }
    if (file.value) {
      const form = new FormData()
      if (text.value.trim()) form.append('caption', text.value.trim())
      form.append('file', file.value, file.value.name)
      res = await api(`/conversations/${props.conversationId}/messages`, {
        method: 'POST',
        body: form,
      })
    } else {
      res = await api(`/conversations/${props.conversationId}/messages`, {
        method: 'POST',
        body: { type: 'text', body: text.value.trim() },
      })
    }
    text.value = ''
    file.value = null
    await nextTick(autoGrow)
    emit('sent', res.message)
  } catch (err) {
    error.value = toMessage(err)
  } finally {
    busy.value = false
    textarea.value?.focus()
  }
}
</script>

<template>
  <form
    class="border-t border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900"
    @submit.prevent="send"
  >
    <FormAlert :message="error" class="mb-2" />

    <div
      v-if="file"
      class="mb-2 flex items-center gap-3 rounded-xl bg-slate-100 p-2 dark:bg-slate-800"
    >
      <img v-if="previewUrl" :src="previewUrl" alt="" class="size-12 rounded-lg object-cover" />
      <span
        v-else
        class="grid size-12 place-items-center rounded-lg bg-white text-xl dark:bg-slate-700"
        >📄</span
      >
      <span class="min-w-0 flex-1 truncate text-sm" dir="auto">{{ file.name }}</span>
      <button
        type="button"
        class="rounded-lg px-2 py-1 text-sm text-slate-600 hover:bg-white dark:hover:bg-slate-700"
        :aria-label="$t('inbox.removeFile')"
        @click="file = null"
      >
        ✕
      </button>
    </div>

    <div class="flex items-end gap-2">
      <input ref="fileInput" type="file" class="hidden" @change="pickFile" />
      <button
        type="button"
        class="grid size-10 shrink-0 place-items-center rounded-xl text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800"
        :title="$t('inbox.attach')"
        :aria-label="$t('inbox.attach')"
        :disabled="disabled"
        @click="fileInput?.click()"
      >
        <svg
          viewBox="0 0 24 24"
          class="size-5"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
        >
          <path
            d="m21 11-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l8-8"
          />
        </svg>
      </button>
      <textarea
        ref="textarea"
        v-model="text"
        rows="1"
        dir="auto"
        class="input min-h-10 flex-1 resize-none py-2"
        :placeholder="file ? $t('inbox.caption') : $t('inbox.composerPlaceholder')"
        :disabled="disabled"
        maxlength="4096"
        @input="autoGrow"
        @keydown="onKeydown"
      />
      <button type="submit" class="btn-primary h-10 shrink-0" :disabled="!canSend">
        {{ $t('inbox.send') }}
      </button>
    </div>
  </form>
</template>
