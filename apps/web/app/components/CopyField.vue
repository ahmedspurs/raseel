<script setup lang="ts">
const props = defineProps<{ label: string; value: string; id: string }>()
const copied = ref(false)

async function copy() {
  await navigator.clipboard.writeText(props.value)
  copied.value = true
  setTimeout(() => (copied.value = false), 2000)
}
</script>

<template>
  <div>
    <label class="label" :for="id">{{ label }}</label>
    <div class="flex gap-2">
      <input
        :id="id"
        :value="value"
        class="input ltr font-mono text-xs"
        readonly
        @focus="($event.target as HTMLInputElement).select()"
      />
      <button type="button" class="btn-secondary shrink-0" @click="copy">
        {{ copied ? $t('common.copied') : $t('common.copy') }}
      </button>
    </div>
  </div>
</template>
