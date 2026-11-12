<script setup lang="ts">
import {
  AlertCircle,
  CornerDownLeft,
  FileText,
  MapPin,
  RotateCw,
  Settings2,
  UserRound,
} from 'lucide-vue-next'
import type { InboxMessage } from '~/types/inbox'

const props = defineProps<{ message: InboxMessage }>()
const emit = defineEmits<{ retry: [id: string] }>()
const { time } = useFormat()

const outbound = computed(() => props.message.direction === 'OUTBOUND')
const payload = computed(() => (props.message.payload ?? {}) as Record<string, unknown>)
/** Reply buttons attached to an automated or interactive message. */
const outboundButtons = computed(
  () => (props.message.payload as { buttons?: string[] } | null)?.buttons ?? [],
)

const location = computed(() => {
  if (props.message.type !== 'LOCATION') return null
  const { latitude, longitude, name, address } = payload.value as {
    latitude: number
    longitude: number
    name?: string
    address?: string
  }
  return {
    name,
    address,
    url: `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=17/${latitude}/${longitude}`,
  }
})

const sharedContacts = computed(
  () =>
    (payload.value.contacts as { name: string | null; phones: { phone: string | null }[] }[]) ?? [],
)

const showBody = computed(
  () => props.message.body && !['REACTION', 'LOCATION', 'CONTACTS'].includes(props.message.type),
)
const isButtonReply = computed(
  () => !outbound.value && ['INTERACTIVE', 'BUTTON'].includes(props.message.type),
)

/** Customer bubbles sit at the start (right in Arabic) with the tail at the top start corner. */
const shape = computed(() =>
  outbound.value
    ? 'rounded-3xl rounded-se-lg bg-slate-900 text-white'
    : 'rounded-3xl rounded-ss-lg border border-slate-200 bg-white text-slate-900',
)
</script>

<template>
  <!-- Reactions render as a quiet line, not a bubble. -->
  <div v-if="message.type === 'REACTION'" class="flex justify-center">
    <span class="text-xs text-slate-500">
      {{ message.body ? $t('inbox.reacted', { emoji: message.body }) : $t('inbox.reactionRemoved')
      }}<template v-if="message.replyTo?.body">
        · <span dir="auto">“{{ message.replyTo.body.slice(0, 40) }}”</span></template
      >
    </span>
  </div>

  <div v-else class="flex flex-col gap-1" :class="outbound ? 'items-end' : 'items-start'">
    <div class="max-w-[85%] px-3.5 py-2.5 sm:max-w-[65%]" :class="shape">
      <div
        v-if="message.replyTo"
        class="mb-2 border-s-2 ps-2.5 text-[13px]"
        :class="outbound ? 'border-slate-500 text-slate-300' : 'border-slate-300 text-slate-500'"
      >
        <p class="line-clamp-2" dir="auto">
          <PreviewText :text="message.replyTo.body ?? `[${message.replyTo.type}]`" />
        </p>
      </div>

      <template v-if="message.media">
        <p v-if="message.media.pending" class="px-1 py-6 text-center text-sm opacity-70">
          {{ $t('inbox.mediaPending') }}
        </p>
        <template v-else-if="message.media.url">
          <a
            v-if="message.type === 'IMAGE' || message.type === 'STICKER'"
            :href="message.media.url"
            target="_blank"
            rel="noopener"
            class="-mx-1.5 -mt-1 block"
          >
            <img
              :src="message.media.url"
              :alt="message.body ?? ''"
              loading="lazy"
              class="rounded-lg"
              :class="
                message.type === 'STICKER'
                  ? 'size-32 object-contain'
                  : 'max-h-80 w-full object-cover'
              "
            />
          </a>
          <video
            v-else-if="message.type === 'VIDEO'"
            :src="message.media.url"
            controls
            preload="metadata"
            class="-mx-1.5 -mt-1 max-h-80 w-[calc(100%+0.75rem)] rounded-lg"
          />
          <audio
            v-else-if="message.type === 'AUDIO'"
            :src="message.media.url"
            controls
            preload="metadata"
            class="w-64 max-w-full"
          />
          <a
            v-else
            :href="message.media.url"
            class="flex items-center gap-2.5 rounded-lg px-2.5 py-2"
            :class="outbound ? 'bg-slate-800' : 'bg-slate-50'"
          >
            <FileText class="size-5 shrink-0" :stroke-width="1.5" aria-hidden="true" />
            <span class="min-w-0 flex-1 truncate text-sm" dir="auto">
              {{ message.media.filename ?? $t('inbox.download') }}
            </span>
          </a>
        </template>
      </template>

      <a v-if="location" :href="location.url" target="_blank" rel="noopener" class="flex gap-2.5">
        <MapPin class="mt-0.5 size-5 shrink-0" :stroke-width="1.5" aria-hidden="true" />
        <span>
          <span class="block font-medium">{{ location.name ?? $t('inbox.openMap') }}</span>
          <span v-if="location.address" class="block text-sm opacity-75" dir="auto">{{
            location.address
          }}</span>
          <span class="mt-1 block text-xs underline underline-offset-4">{{
            $t('inbox.openMap')
          }}</span>
        </span>
      </a>

      <ul v-if="message.type === 'CONTACTS'" class="space-y-2">
        <li v-for="(c, i) in sharedContacts" :key="i" class="flex gap-2.5 text-sm">
          <UserRound class="mt-0.5 size-4 shrink-0" :stroke-width="1.5" aria-hidden="true" />
          <span>
            <span class="block font-medium">{{ c.name }}</span>
            <span
              v-for="p in c.phones"
              :key="p.phone ?? ''"
              class="num ltr block text-xs opacity-75"
              >{{ p.phone }}</span
            >
          </span>
        </li>
      </ul>

      <p v-if="message.type === 'UNSUPPORTED'" class="text-sm italic opacity-70">
        {{ $t('inbox.unsupported') }}
      </p>

      <p
        v-if="showBody"
        class="flex gap-1.5 whitespace-pre-wrap break-words text-[15px] leading-6"
        :class="{ 'mt-2': message.media }"
        dir="auto"
      >
        <CornerDownLeft
          v-if="isButtonReply"
          class="mt-1 size-4 shrink-0 text-slate-400"
          :stroke-width="1.5"
          aria-hidden="true"
        />
        <span>{{ message.body }}</span>
      </p>

      <div v-if="outbound && outboundButtons.length" class="mt-2.5 flex flex-wrap gap-1.5">
        <span
          v-for="b in outboundButtons"
          :key="b"
          class="rounded-md border border-slate-600 px-2.5 py-1 text-xs text-slate-200"
        >
          {{ b }}
        </span>
      </div>
    </div>

    <div class="flex items-center gap-1.5 px-1 text-[11px] text-slate-500">
      <span v-if="outbound && message.sentBy">{{ message.sentBy.name }}</span>
      <span v-else-if="outbound && message.automated" class="flex items-center gap-1">
        <Settings2 class="size-3" :stroke-width="1.5" aria-hidden="true" />{{
          $t('automation.automated')
        }}
      </span>
      <time class="num" :datetime="message.createdAt">{{
        time.format(new Date(message.createdAt))
      }}</time>
      <MessageStatusIcon v-if="outbound" :status="message.status" />
    </div>

    <div
      v-if="message.status === 'FAILED'"
      class="flex max-w-[85%] items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 sm:max-w-[65%]"
    >
      <AlertCircle class="mt-0.5 size-4 shrink-0" :stroke-width="1.5" aria-hidden="true" />
      <div class="min-w-0 flex-1">
        <p class="font-semibold">{{ $t('inbox.failed') }}</p>
        <p v-if="message.error?.message" dir="auto">{{ message.error.message }}</p>
      </div>
      <button
        type="button"
        class="flex shrink-0 items-center gap-1 font-semibold hover:underline"
        @click="emit('retry', message.id)"
      >
        <RotateCw class="size-3.5" :stroke-width="1.5" aria-hidden="true" />{{ $t('inbox.retry') }}
      </button>
    </div>
  </div>
</template>
