<script setup lang="ts">
const inbox = useInboxStore()
const auth = useAuthStore()
</script>

<template>
  <div class="flex flex-1 items-center justify-center p-8">
    <div class="max-w-sm">
      <template v-if="inbox.connected === false">
        <h1 class="text-xl font-bold">{{ $t('inbox.emptyTitle') }}</h1>
        <p class="mt-2 text-[15px] text-slate-600">{{ $t('inbox.emptyBody') }}</p>
        <NuxtLink
          v-if="auth.can('whatsapp:manage')"
          to="/settings/whatsapp"
          class="btn-primary mt-5"
        >
          {{ $t('inbox.connectNow') }}
        </NuxtLink>
      </template>
      <p v-else class="text-sm text-slate-500">{{ $t('inbox.selectConversation') }}</p>
    </div>
  </div>
</template>
