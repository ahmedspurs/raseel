<script setup lang="ts">
withDefaults(defineProps<{ size?: number; inverted?: boolean; wordmark?: boolean }>(), {
  size: 32,
  inverted: false,
  wordmark: false,
})
</script>

<template>
  <span class="inline-flex items-center gap-2.5">
    <svg :width="size" :height="size" viewBox="0 0 36 36" aria-hidden="true">
      <rect width="36" height="36" rx="9" :fill="inverted ? '#F7F7F5' : '#17181B'" />
      <path
        d="M11 13.5h14M11 18.5h9M11 23.5h5"
        :stroke="inverted ? '#17181B' : '#F7F7F5'"
        stroke-width="2.2"
        stroke-linecap="round"
      />
      <circle cx="25" cy="23.5" r="2.6" fill="#22A06B" />
    </svg>
    <span v-if="wordmark" class="font-display text-xl font-bold">{{ $t('app.name') }}</span>
  </span>
</template>
