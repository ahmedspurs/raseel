<script setup lang="ts">
defineProps<{ message?: string | null; tone?: 'error' | 'success' | 'info' }>()
</script>

<template>
  <p
    v-if="message"
    role="alert"
    class="rounded-xl px-3.5 py-2.5 text-sm"
    :class="{
      'bg-rose-50 text-rose-800 dark:bg-rose-950 dark:text-rose-200': (tone ?? 'error') === 'error',
      'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200':
        tone === 'success',
      'bg-sky-50 text-sky-800 dark:bg-sky-950 dark:text-sky-200': tone === 'info',
    }"
  >
    {{ message }}
  </p>
</template>
