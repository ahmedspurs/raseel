<script setup lang="ts">
import {
  FileText,
  Image,
  LayoutTemplate,
  MapPin,
  Mic,
  Smile,
  Sticker,
  UserRound,
  Video,
} from 'lucide-vue-next'
import type { Component } from 'vue'

/**
 * Conversation previews store "[IMAGE]"-style tokens for messages without text;
 * show them as an icon and a translated label. Older emoji previews pass through.
 */
const props = defineProps<{ text: string | null }>()

const TYPES: Record<string, { icon: Component; key: string }> = {
  IMAGE: { icon: Image, key: 'image' },
  VIDEO: { icon: Video, key: 'video' },
  AUDIO: { icon: Mic, key: 'audio' },
  DOCUMENT: { icon: FileText, key: 'document' },
  STICKER: { icon: Sticker, key: 'sticker' },
  LOCATION: { icon: MapPin, key: 'location' },
  CONTACTS: { icon: UserRound, key: 'contacts' },
  REACTION: { icon: Smile, key: 'reaction' },
  TEMPLATE: { icon: LayoutTemplate, key: 'template' },
}

const token = computed(() => {
  const m = props.text?.match(/^\[([A-Z]+)\]$/)
  return m ? (TYPES[m[1]!] ?? null) : null
})
</script>

<template>
  <span v-if="token" class="inline-flex items-center gap-1.5">
    <component :is="token.icon" class="size-4 shrink-0" :stroke-width="1.5" aria-hidden="true" />
    {{ $t(`inbox.types.${token.key}`) }}
  </span>
  <span v-else dir="auto">{{ text }}</span>
</template>
