<script setup lang="ts">
import type { InboxMessage, InboxNote } from '~/types/inbox'

const props = defineProps<{
  conversationId: string
  canReply: boolean
  windowOpen: boolean
  canNote: boolean
}>()
const emit = defineEmits<{ sent: [message: InboxMessage]; noted: [note: InboxNote] }>()

const api = useApi()
const toMessage = useApiError()
const directory = useDirectoryStore()
const auth = useAuthStore()
const realtime = useRealtime()
const { t } = useI18n()

type Mode = 'reply' | 'note'
const mode = ref<Mode>(props.canReply && props.windowOpen ? 'reply' : 'note')
const text = ref('')
const file = ref<File | null>(null)
const busy = ref(false)
const error = ref<string | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const textarea = ref<HTMLTextAreaElement | null>(null)

const replyAllowed = computed(() => props.canReply && props.windowOpen)
watch(replyAllowed, (ok) => {
  if (!ok && mode.value === 'reply') mode.value = 'note'
})

const previewUrl = computed(() =>
  file.value && file.value.type.startsWith('image/') ? URL.createObjectURL(file.value) : null,
)
watch(previewUrl, (_, old) => old && URL.revokeObjectURL(old))

const canSend = computed(
  () =>
    !busy.value &&
    (mode.value === 'note'
      ? text.value.trim()
      : replyAllowed.value && (text.value.trim() || file.value)),
)

// ── Typing presence (FR-19) ──
let typingTimer: ReturnType<typeof setTimeout> | undefined
let typingSent = false
function setTyping(on: boolean) {
  if (typingSent === on) return
  typingSent = on
  realtime.socket()?.emit('typing', on)
}
function onTypingActivity() {
  if (mode.value !== 'reply') return
  setTyping(true)
  clearTimeout(typingTimer)
  typingTimer = setTimeout(() => setTyping(false), 3000)
}
onBeforeUnmount(() => {
  clearTimeout(typingTimer)
  setTyping(false)
})

// ── "/" quick replies and "@" mentions ──
interface Suggestion {
  key: string
  label: string
  detail: string
  apply: () => void
}
const suggestionQuery = ref<{ kind: 'quick' | 'mention'; query: string; start: number } | null>(
  null,
)
const activeIndex = ref(0)
/** Display name → user id for mentions inserted in this note. */
const mentionIds = new Map<string, string>()

function detectSuggestion() {
  const el = textarea.value
  if (!el) return
  const before = text.value.slice(0, el.selectionStart)
  const quick = mode.value === 'reply' ? before.match(/(?:^|\s)\/([\p{L}\p{N}_-]*)$/u) : null
  const mention = mode.value === 'note' ? before.match(/(?:^|\s)@([\p{L}\p{N}_ ]{0,30})$/u) : null
  const m = quick ?? mention
  suggestionQuery.value = m
    ? {
        kind: quick ? 'quick' : 'mention',
        query: m[1]!.toLowerCase(),
        start: before.length - m[1]!.length - 1,
      }
    : null
  activeIndex.value = 0
}

function replaceToken(insert: string) {
  const s = suggestionQuery.value
  const el = textarea.value
  if (!s || !el) return
  const end = el.selectionStart
  text.value = text.value.slice(0, s.start) + insert + text.value.slice(end)
  suggestionQuery.value = null
  void nextTick(() => {
    const pos = s.start + insert.length
    el.focus()
    el.setSelectionRange(pos, pos)
    autoGrow()
  })
}

const suggestions = computed<Suggestion[]>(() => {
  const s = suggestionQuery.value
  if (!s) return []
  if (s.kind === 'quick') {
    return directory.quickReplies
      .filter((q) => q.shortcut.includes(s.query) || q.title.toLowerCase().includes(s.query))
      .slice(0, 8)
      .map((q) => ({
        key: q.id,
        label: `/${q.shortcut}`,
        detail: q.title,
        apply: () => replaceToken(q.body),
      }))
  }
  return directory.users
    .filter(
      (u) => u.active && u.id !== auth.user?.id && u.name.toLowerCase().includes(s.query.trim()),
    )
    .slice(0, 8)
    .map((u) => ({
      key: u.id,
      label: `@${u.name}`,
      detail: t(`roles.${u.role}`),
      apply: () => {
        mentionIds.set(u.name, u.id)
        replaceToken(`@${u.name} `)
      },
    }))
})

function onKeydown(e: KeyboardEvent) {
  if (suggestionQuery.value && suggestions.value.length) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const n = suggestions.value.length
      activeIndex.value = (activeIndex.value + (e.key === 'ArrowDown' ? 1 : n - 1)) % n
      return
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      suggestions.value[activeIndex.value]?.apply()
      return
    }
    if (e.key === 'Escape') {
      suggestionQuery.value = null
      return
    }
  }
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    void send()
  }
}

function switchToNote() {
  mode.value = 'note'
  setTyping(false)
}

function onInput() {
  autoGrow()
  detectSuggestion()
  onTypingActivity()
}

function autoGrow() {
  const el = textarea.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 200)}px`
}

function pickFile(event: Event) {
  const input = event.target as HTMLInputElement
  file.value = input.files?.[0] ?? null
  input.value = ''
}

/** Converts "@Name" back to mention tokens the server understands. */
function encodeMentions(body: string) {
  let out = body
  for (const [name, id] of [...mentionIds].sort((a, b) => b[0].length - a[0].length)) {
    out = out.split(`@${name}`).join(`<@${id}>`)
  }
  return out
}

async function send() {
  if (!canSend.value) return
  busy.value = true
  error.value = null
  try {
    if (mode.value === 'note') {
      const res = await api<{ note: InboxNote }>(`/conversations/${props.conversationId}/notes`, {
        method: 'POST',
        body: { body: encodeMentions(text.value.trim()) },
      })
      mentionIds.clear()
      emit('noted', res.note)
    } else if (file.value) {
      const form = new FormData()
      if (text.value.trim()) form.append('caption', text.value.trim())
      form.append('file', file.value, file.value.name)
      const res = await api<{ message: InboxMessage }>(
        `/conversations/${props.conversationId}/messages`,
        { method: 'POST', body: form },
      )
      emit('sent', res.message)
    } else {
      const res = await api<{ message: InboxMessage }>(
        `/conversations/${props.conversationId}/messages`,
        { method: 'POST', body: { type: 'text', body: text.value.trim() } },
      )
      emit('sent', res.message)
    }
    text.value = ''
    file.value = null
    setTyping(false)
    await nextTick(autoGrow)
  } catch (err) {
    error.value = toMessage(err)
  } finally {
    busy.value = false
    textarea.value?.focus()
  }
}

// ── Voice notes ──
const recorder = ref<MediaRecorder | null>(null)
const recordedMs = ref(0)
let chunks: Blob[] = []
let recordTimer: ReturnType<typeof setInterval> | undefined
let cancelled = false
const MAX_RECORDING_MS = 5 * 60_000

const recordingLabel = computed(() => {
  const s = Math.floor(recordedMs.value / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
})

function pickAudioType(): string {
  const candidates = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/mp4', 'audio/webm']
  return candidates.find((c) => MediaRecorder.isTypeSupported(c)) ?? ''
}

async function startRecording() {
  error.value = null
  if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    error.value = t('inbox.audioUnsupported')
    return
  }
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch {
    error.value = t('inbox.micDenied')
    return
  }
  const mimeType = pickAudioType()
  const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
  chunks = []
  cancelled = false
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
  rec.onstop = async () => {
    stream.getTracks().forEach((track) => track.stop())
    clearInterval(recordTimer)
    recorder.value = null
    if (cancelled || !chunks.length) return
    const type = rec.mimeType || mimeType || 'audio/webm'
    const ext = type.includes('ogg') ? 'ogg' : type.includes('mp4') ? 'm4a' : 'webm'
    file.value = new File(chunks, `voice-note.${ext}`, { type })
    text.value = ''
    await send()
  }
  rec.start(250)
  recorder.value = rec
  recordedMs.value = 0
  const started = Date.now()
  recordTimer = setInterval(() => {
    recordedMs.value = Date.now() - started
    if (recordedMs.value >= MAX_RECORDING_MS) rec.stop()
  }, 250)
}

function stopRecording(send = true) {
  cancelled = !send
  recorder.value?.stop()
}
onBeforeUnmount(() => stopRecording(false))
</script>

<template>
  <form
    class="border-t bg-white p-3 dark:bg-slate-900"
    :class="
      mode === 'note'
        ? 'border-amber-300 dark:border-amber-800'
        : 'border-slate-200 dark:border-slate-800'
    "
    @submit.prevent="send"
  >
    <div class="mb-2 flex gap-1 text-sm">
      <button
        v-if="canReply"
        type="button"
        class="rounded-lg px-3 py-1 font-medium"
        :class="
          mode === 'reply'
            ? 'bg-brand-700 text-white'
            : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
        "
        :disabled="!replyAllowed"
        @click="mode = 'reply'"
      >
        {{ $t('inbox.reply') }}
      </button>
      <button
        v-if="canNote"
        type="button"
        class="rounded-lg px-3 py-1 font-medium"
        :class="
          mode === 'note'
            ? 'bg-amber-400 text-amber-950'
            : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
        "
        @click="switchToNote"
      >
        {{ $t('inbox.note') }}
      </button>
    </div>

    <p
      v-if="mode === 'reply' && !replyAllowed"
      class="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
    >
      {{ $t('inbox.windowClosed') }}
    </p>

    <FormAlert :message="error" class="mb-2" />

    <div
      v-if="file && !recorder"
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

    <div
      v-if="recorder"
      class="flex items-center gap-3 rounded-xl bg-rose-50 px-3 py-2 dark:bg-rose-950"
    >
      <span class="size-2.5 animate-pulse rounded-full bg-rose-600" aria-hidden="true" />
      <span class="flex-1 text-sm font-medium text-rose-900 dark:text-rose-100">
        {{ $t('inbox.recording', { time: recordingLabel }) }}
      </span>
      <button type="button" class="btn-secondary py-1.5 text-xs" @click="stopRecording(false)">
        {{ $t('inbox.cancelRecording') }}
      </button>
      <button type="button" class="btn-primary py-1.5 text-xs" @click="stopRecording(true)">
        {{ $t('inbox.stopRecording') }}
      </button>
    </div>

    <div v-else class="relative flex items-end gap-2">
      <ul
        v-if="suggestionQuery"
        class="card absolute bottom-full start-0 z-20 mb-2 max-h-64 w-72 max-w-full overflow-y-auto py-1"
        role="listbox"
      >
        <li v-if="!suggestions.length" class="px-3 py-2 text-sm text-slate-500">
          {{
            suggestionQuery.kind === 'quick'
              ? $t('inbox.noQuickReplies', { q: suggestionQuery.query })
              : '—'
          }}
        </li>
        <li
          v-for="(s, i) in suggestions"
          :key="s.key"
          role="option"
          :aria-selected="i === activeIndex"
          class="cursor-pointer px-3 py-2 text-sm"
          :class="i === activeIndex ? 'bg-brand-50 dark:bg-brand-900/40' : ''"
          @mousedown.prevent="s.apply()"
          @mouseenter="activeIndex = i"
        >
          <span class="font-semibold" dir="auto">{{ s.label }}</span>
          <span class="ms-2 text-slate-500" dir="auto">{{ s.detail }}</span>
        </li>
      </ul>

      <template v-if="mode === 'reply'">
        <input ref="fileInput" type="file" class="hidden" @change="pickFile" />
        <button
          type="button"
          class="grid size-10 shrink-0 place-items-center rounded-xl text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800"
          :title="$t('inbox.attach')"
          :aria-label="$t('inbox.attach')"
          :disabled="!replyAllowed"
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
      </template>

      <textarea
        ref="textarea"
        v-model="text"
        rows="1"
        dir="auto"
        class="input min-h-10 flex-1 resize-none py-2"
        :class="{ 'border-amber-300 bg-amber-50/60 dark:bg-amber-950/30': mode === 'note' }"
        :placeholder="
          mode === 'note'
            ? $t('inbox.notePlaceholder')
            : file
              ? $t('inbox.caption')
              : $t('inbox.composerPlaceholder')
        "
        :disabled="mode === 'reply' && !replyAllowed"
        maxlength="4096"
        @input="onInput"
        @click="detectSuggestion"
        @keydown="onKeydown"
        @blur="suggestionQuery = null"
      />

      <button
        v-if="mode === 'reply' && !text.trim() && !file"
        type="button"
        class="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-700 text-white hover:bg-brand-800 disabled:opacity-50"
        :title="$t('inbox.record')"
        :aria-label="$t('inbox.record')"
        :disabled="!replyAllowed || busy"
        @click="startRecording"
      >
        <svg
          viewBox="0 0 24 24"
          class="size-5"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
        >
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
        </svg>
      </button>
      <button
        v-else
        type="submit"
        class="h-10 shrink-0"
        :class="
          mode === 'note' ? 'btn bg-amber-400 text-amber-950 hover:bg-amber-500' : 'btn-primary'
        "
        :disabled="!canSend"
      >
        {{ mode === 'note' ? $t('inbox.addNote') : $t('inbox.send') }}
      </button>
    </div>
  </form>
</template>
