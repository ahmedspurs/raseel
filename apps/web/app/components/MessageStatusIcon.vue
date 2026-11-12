<script setup lang="ts">
import { AlertCircle, Check, CheckCheck, Clock3 } from 'lucide-vue-next'
import type { MessageStatus } from '~/types/inbox'

defineProps<{ status: MessageStatus }>()
</script>

<template>
  <span
    class="inline-flex"
    role="img"
    :title="$t(`inbox.status.${status}`)"
    :aria-label="$t(`inbox.status.${status}`)"
  >
    <Clock3 v-if="status === 'QUEUED'" class="size-3.5" :stroke-width="1.75" aria-hidden="true" />
    <Check v-else-if="status === 'SENT'" class="size-3.5" :stroke-width="2" aria-hidden="true" />
    <CheckCheck
      v-else-if="status === 'DELIVERED' || status === 'READ'"
      class="size-4"
      :class="{ 'text-read': status === 'READ' }"
      :stroke-width="2"
      aria-hidden="true"
    />
    <AlertCircle
      v-else-if="status === 'FAILED'"
      class="size-3.5 text-rose-600"
      :stroke-width="2"
      aria-hidden="true"
    />
  </span>
</template>
