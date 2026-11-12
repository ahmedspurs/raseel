<script setup lang="ts">
import { Clock3, FileText, Lock, Mic, Paperclip, Send, X } from 'lucide-vue-next'
import type { InboxMessage, InboxNote } from '~/types/inbox'

const props = defineProps<{
  conversationId: string
  canReply: boolean
  windowOpen: boolean
  canNote: boolean
  /** When the 24-hour customer service window closes (FR-13). */
  windowClosesAt?: string | null
}>()
const emit = defineEmits<{ sent: [message: InboxMessage]; noted: [note: InboxNote] }>()

const api = useApi()
const toMessage = useApiError()
const directory = useDirectoryStore()
const auth = useAuthStore()
const realtime = useRealtime()
const { t } = useI18n()
const { duration } = useFormat()
const nowMs = ref(Date.now())
const windowClock = setInterval(() => (nowMs.value = Date.now()), 30_000)
onBeforeUnmount(() => clearInterval(windowClock))
const windowRemaining = computed(() =>
  props.windowClosesAt ? Math.max(0, new Date(props.windowClosesAt).getTime() - nowMs.value) : 0,
)
/** Under three hours left: warn in amber. */
const windowUrgent = computed(
  () => windowRemaining.value > 0 && windowRemaining.value < 3 * 3600_000,
)

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
  <form class="border-t border-slate-200 bg-white px-4 pb-4 pt-2.5 md:px-6" @submit.prevent="send">
    <div class="mb-2 flex items-center justify-between gap-3">
      <div class="flex gap-5 text-[13px]" role="tablist">
        <button
          v-if="canReply"
          type="button"
          role="tab"
          :aria-selected="mode === 'reply'"
          class="border-b-2 pb-1 font-medium"
          :class="
            mode === 'reply'
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          "
          :disabled="!replyAllowed"
          @click="mode = 'reply'"
        >
          {{ $t('inbox.reply') }}
        </button>
        <button
          v-if="canNote"
          type="button"
          role="tab"
          :aria-selected="mode === 'note'"
          class="flex items-center gap-1.5 border-b-2 pb-1 font-medium"
          :class="
            mode === 'note'
              ? 'border-amber-500 text-amber-800'
              : 'border-transparent text-slate-500 hover:text-slate-900'
          "
          @click="switchToNote"
        >
          <Lock class="size-3.5" :stroke-width="1.5" aria-hidden="true" />{{ $t('inbox.note') }}
        </button>
      </div>
      <span
        v-if="windowOpen && windowClosesAt"
        class="flex items-center gap-1.5 text-xs"
        :class="windowUrgent ? 'font-medium text-warn' : 'text-slate-500'"
      >
        <Clock3 class="size-3.5" :stroke-width="1.5" aria-hidden="true" />
        {{ $t('inbox.windowOpen', { time: duration(windowRemaining) }) }}
      </span>
    </div>

    <p
      v-if="mode === 'reply' && !replyAllowed"
      class="mb-2 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900"
    >
      <Clock3 class="size-4 shrink-0" :stroke-width="1.5" aria-hidden="true" />{{
        $t('inbox.windowClosed')
      }}
    </p>

    <FormAlert :message="error" class="mb-2" />

    <div
      v-if="file && !recorder"
      class="mb-2 flex items-center gap-3 rounded-xl border border-slate-200 p-2"
    >
      <img v-if="previewUrl" :src="previewUrl" alt="" class="size-11 rounded-lg object-cover" />
      <span v-else class="grid size-11 place-items-center rounded-lg bg-slate-100 text-slate-600">
        <FileText class="size-5" :stroke-width="1.5" aria-hidden="true" />
      </span>
      <span class="min-w-0 flex-1 truncate text-sm" dir="auto">{{ file.name }}</span>
      <button
        type="button"
        class="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
        :aria-label="$t('inbox.removeFile')"
        @click="file = null"
      >
        <X class="size-4" :stroke-width="1.5" aria-hidden="true" />
      </button>
    </div>

    <div
      v-if="recorder"
      class="flex items-center gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2"
    >
      <span class="size-2.5 animate-pulse rounded-full bg-rose-600" aria-hidden="true" />
      <span class="num flex-1 text-sm font-medium text-rose-900">
        {{ $t('inbox.recording', { time: recordingLabel }) }}
      </span>
      <button type="button" class="btn-ghost min-h-9 text-[13px]" @click="stopRecording(false)">
        {{ $t('inbox.cancelRecording') }}
      </button>
      <button type="button" class="btn-primary min-h-9 text-[13px]" @click="stopRecording(true)">
        {{ $t('inbox.stopRecording') }}
      </button>
    </div>

    <div
      v-else
      class="relative flex items-end gap-1 rounded-2xl border p-1.5 transition-colors focus-within:border-slate-900 focus-within:ring-3 focus-within:ring-slate-900/10"
      :class="
        mode === 'note'
          ? 'border-dashed border-amber-300 bg-amber-50/50'
          : 'border-slate-300 bg-white'
      "
    >
      <ul
        v-if="suggestionQuery"
        class="card absolute bottom-full start-0 z-20 mb-2 max-h-64 w-80 max-w-full overflow-y-auto p-1 shadow-lg"
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
          class="flex cursor-pointer items-baseline gap-2 rounded-lg px-3 py-2 text-sm"
          :class="i === activeIndex ? 'bg-slate-100' : ''"
          @mousedown.prevent="s.apply()"
          @mouseenter="activeIndex = i"
        >
          <span class="font-semibold" dir="auto">{{ s.label }}</span>
          <span class="truncate text-slate-500" dir="auto">{{ s.detail }}</span>
        </li>
      </ul>

      <template v-if="mode === 'reply'">
        <input ref="fileInput" type="file" class="hidden" @change="pickFile" />
        <button
          type="button"
          class="grid size-9 shrink-0 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40"
          :title="$t('inbox.attach')"
          :aria-label="$t('inbox.attach')"
          :disabled="!replyAllowed"
          @click="fileInput?.click()"
        >
          <Paperclip class="size-5" :stroke-width="1.5" aria-hidden="true" />
        </button>
      </template>

      <label class="sr-only" for="composer-text">{{
        mode === 'note' ? $t('inbox.note') : $t('inbox.reply')
      }}</label>
      <textarea
        id="composer-text"
        ref="textarea"
        v-model="text"
        rows="1"
        dir="auto"
        class="min-h-9 flex-1 resize-none border-0 bg-transparent px-1.5 py-1.5 text-[15px] leading-6 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed"
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
        class="grid size-9 shrink-0 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40"
        :title="$t('inbox.record')"
        :aria-label="$t('inbox.record')"
        :disabled="!replyAllowed || busy"
        @click="startRecording"
      >
        <Mic class="size-5" :stroke-width="1.5" aria-hidden="true" />
      </button>
      <button
        v-else
        type="submit"
        class="btn min-h-9 shrink-0 px-3.5"
        :class="
          mode === 'note'
            ? 'bg-amber-500 text-amber-950 hover:bg-amber-400'
            : 'bg-slate-900 text-white hover:bg-slate-800'
        "
        :disabled="!canSend"
      >
        <span>{{ mode === 'note' ? $t('inbox.addNote') : $t('inbox.send') }}</span>
        <Send
          v-if="mode === 'reply'"
          class="size-4 rtl:-scale-x-100"
          :stroke-width="1.5"
          aria-hidden="true"
        />
      </button>
    </div>
  </form>
</template>
