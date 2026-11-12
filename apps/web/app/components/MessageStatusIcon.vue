<script setup lang="ts">
import type { MessageStatus } from '~/types/inbox'

defineProps<{ status: MessageStatus }>()
</script>

<template>
  <span
    :title="$t(`inbox.status.${status}`)"
    class="inline-flex"
    role="img"
    :aria-label="$t(`inbox.status.${status}`)"
  >
    <!-- Queued: clock -->
    <svg
      v-if="status === 'QUEUED'"
      viewBox="0 0 16 16"
      class="size-3.5"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
    >
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v3l2 1.5" stroke-linecap="round" />
    </svg>
    <!-- Sent: single tick -->
    <svg
      v-else-if="status === 'SENT'"
      viewBox="0 0 16 16"
      class="size-3.5"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
    >
      <path d="m3 8.5 3 3 7-7" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
    <!-- Delivered / read: double tick (read in light blue) -->
    <svg
      v-else-if="status === 'DELIVERED' || status === 'READ'"
      viewBox="0 0 20 16"
      class="h-3.5 w-4"
      :class="{ 'text-sky-300': status === 'READ' }"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
    >
      <path d="m1.5 8.5 3 3 7-7M8 11.5l7-7" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
    <!-- Failed -->
    <svg
      v-else-if="status === 'FAILED'"
      viewBox="0 0 16 16"
      class="size-3.5 text-rose-300"
      fill="currentColor"
    >
      <path
        d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm.75 9.75h-1.5v-1.5h1.5v1.5Zm0-3h-1.5v-4h1.5v4Z"
      />
    </svg>
  </span>
</template>
