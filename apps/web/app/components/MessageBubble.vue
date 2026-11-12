<script setup lang="ts">
import type { InboxMessage } from '~/types/inbox'

const props = defineProps<{ message: InboxMessage }>()
const emit = defineEmits<{ retry: [id: string] }>()
const { time } = useFormat()

const outbound = computed(() => props.message.direction === 'OUTBOUND')
const payload = computed(() => (props.message.payload ?? {}) as Record<string, unknown>)

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

/** Text shown under media, or the body for text-like messages. */
const showBody = computed(
  () => props.message.body && !['REACTION', 'LOCATION', 'CONTACTS'].includes(props.message.type),
)
</script>

<template>
  <!-- Reactions render as a small centered note, not a bubble. -->
  <div v-if="message.type === 'REACTION'" class="flex justify-center">
    <span
      class="rounded-full bg-slate-200/70 px-3 py-1 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300"
    >
      {{
        message.body ? $t('inbox.reacted', { emoji: message.body }) : $t('inbox.reactionRemoved')
      }}
      <template v-if="message.replyTo?.body">
        · <span dir="auto">“{{ message.replyTo.body.slice(0, 40) }}”</span></template
      >
    </span>
  </div>

  <div v-else class="flex" :class="outbound ? 'justify-end' : 'justify-start'">
    <div
      class="max-w-[85%] rounded-2xl px-3.5 py-2 shadow-xs sm:max-w-[70%]"
      :class="
        outbound
          ? 'rounded-ee-md bg-brand-700 text-white'
          : 'rounded-es-md bg-white text-slate-900 dark:bg-slate-800 dark:text-slate-100'
      "
    >
      <p v-if="outbound && message.sentBy" class="mb-0.5 text-xs font-medium text-brand-100">
        {{ message.sentBy.name }}
      </p>

      <div
        v-if="message.replyTo"
        class="mb-1.5 rounded-lg border-s-4 px-2 py-1 text-xs"
        :class="
          outbound
            ? 'border-brand-200 bg-brand-800/60'
            : 'border-brand-500 bg-slate-100 dark:bg-slate-700'
        "
      >
        <span class="opacity-80">{{ $t('inbox.replyTo') }}</span>
        <p class="line-clamp-2" dir="auto">{{ message.replyTo.body ?? '📎' }}</p>
      </div>

      <!-- Media -->
      <template v-if="message.media">
        <p v-if="message.media.pending" class="py-6 text-center text-sm opacity-75">
          {{ $t('inbox.mediaPending') }}
        </p>
        <template v-else-if="message.media.url">
          <a
            v-if="message.type === 'IMAGE' || message.type === 'STICKER'"
            :href="message.media.url"
            target="_blank"
            rel="noopener"
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
            class="max-h-80 w-full rounded-lg"
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
            class="flex items-center gap-2 rounded-lg px-2 py-2"
            :class="outbound ? 'bg-brand-800/60' : 'bg-slate-100 dark:bg-slate-700'"
          >
            <span aria-hidden="true">📄</span>
            <span class="min-w-0 flex-1 truncate text-sm" dir="auto">
              {{ message.media.filename ?? $t('inbox.download') }}
            </span>
          </a>
        </template>
      </template>

      <!-- Location -->
      <a v-if="location" :href="location.url" target="_blank" rel="noopener" class="block">
        <span class="font-medium">📍 {{ location.name ?? $t('inbox.openMap') }}</span>
        <span v-if="location.address" class="block text-sm opacity-80" dir="auto">{{
          location.address
        }}</span>
        <span class="mt-1 block text-xs underline">{{ $t('inbox.openMap') }}</span>
      </a>

      <!-- Shared contacts -->
      <ul v-if="message.type === 'CONTACTS'" class="space-y-1">
        <li v-for="(c, i) in sharedContacts" :key="i" class="text-sm">
          <span class="font-medium">👤 {{ c.name }}</span>
          <span v-for="p in c.phones" :key="p.phone ?? ''" class="ltr block text-xs opacity-80">{{
            p.phone
          }}</span>
        </li>
      </ul>

      <p v-if="message.type === 'UNSUPPORTED'" class="text-sm italic opacity-75">
        {{ $t('inbox.unsupported') }}
      </p>

      <p
        v-if="showBody"
        class="whitespace-pre-wrap break-words"
        :class="{ 'mt-1.5': message.media }"
        dir="auto"
      >
        <span v-if="message.type === 'INTERACTIVE' || message.type === 'BUTTON'" aria-hidden="true"
          >↩︎ </span
        >{{ message.body }}
      </p>

      <div
        class="mt-1 flex items-center justify-end gap-1 text-[11px]"
        :class="outbound ? 'text-brand-100' : 'text-slate-500'"
      >
        <time :datetime="message.createdAt">{{ time.format(new Date(message.createdAt)) }}</time>
        <MessageStatusIcon v-if="outbound" :status="message.status" />
      </div>

      <div
        v-if="message.status === 'FAILED'"
        class="mt-1.5 rounded-lg bg-rose-50 px-2 py-1.5 text-xs text-rose-800"
      >
        <p class="font-semibold">{{ $t('inbox.failed') }}</p>
        <p v-if="message.error?.message" dir="auto">{{ message.error.message }}</p>
        <button
          type="button"
          class="mt-1 font-semibold underline"
          @click="emit('retry', message.id)"
        >
          {{ $t('inbox.retry') }}
        </button>
      </div>
    </div>
  </div>
</template>
