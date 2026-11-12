<template>
  <div class="flex min-h-dvh flex-col bg-slate-50">
    <header class="mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-6">
      <RaseelLogo :size="30" wordmark />
      <LanguageSwitcher />
    </header>
    <main class="flex flex-1 items-start justify-center px-5 pb-16 pt-6 sm:pt-16">
      <slot />
    </main>
    <footer class="px-5 pb-6 text-center text-xs text-slate-500">
      {{ $t('app.tagline') }}
    </footer>
  </div>
</template>
