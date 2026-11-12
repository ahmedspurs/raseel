<script setup lang="ts">
const inbox = useInboxStore()
const auth = useAuthStore()
</script>

<template>
  <div class="grid flex-1 place-items-center p-6">
    <div class="max-w-sm text-center">
      <div
        class="mx-auto mb-5 grid size-16 place-items-center rounded-2xl bg-brand-100 text-brand-700 dark:bg-brand-900/40 dark:text-brand-200"
      >
        <svg
          viewBox="0 0 24 24"
          class="size-8"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linejoin="round"
        >
          <path d="M4 5h16v10h-5l-3 3-3-3H4z" />
        </svg>
      </div>
      <template v-if="inbox.connected === false">
        <h1 class="text-xl font-bold">{{ $t('inbox.emptyTitle') }}</h1>
        <p class="mt-2 text-slate-600 dark:text-slate-400">{{ $t('inbox.emptyBody') }}</p>
        <NuxtLink
          v-if="auth.can('whatsapp:manage')"
          to="/settings/whatsapp"
          class="btn-primary mt-6"
        >
          {{ $t('inbox.connectNow') }}
        </NuxtLink>
      </template>
      <p v-else class="text-slate-600 dark:text-slate-400">{{ $t('inbox.selectConversation') }}</p>
    </div>
  </div>
</template>
