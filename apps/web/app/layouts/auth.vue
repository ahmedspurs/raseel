<template>
  <div class="flex min-h-dvh flex-col bg-gradient-to-b from-brand-50 to-slate-50 dark:from-slate-900 dark:to-slate-950">
    <header class="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-5">
      <div class="flex items-center gap-2.5">
        <img src="/icon.svg" alt="" class="size-9" >
        <span class="text-lg font-bold text-brand-800 dark:text-brand-200">{{ $t('app.name') }}</span>
      </div>
      <LanguageSwitcher />
    </header>
    <main class="flex flex-1 items-start justify-center px-4 pb-12 pt-4 sm:items-center">
      <slot />
    </main>
  </div>
</template>
