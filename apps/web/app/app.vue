<script setup lang="ts">
const { locale, locales, setLocale } = useI18n()
const auth = useAuthStore()

const dir = computed(() => locales.value.find((l) => l.code === locale.value)?.dir ?? 'rtl')

useHead({
  htmlAttrs: { lang: locale, dir },
  titleTemplate: (title) => (title ? `${title} · Raseel` : 'Raseel'),
})

// Follow the signed-in user's saved language (FR-64).
watch(
  () => auth.user?.language,
  (lang) => {
    if (lang && lang !== locale.value) void setLocale(lang)
  },
  { immediate: true },
)
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
