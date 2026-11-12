<script setup lang="ts">
import type { TaskInfo } from '~/types/sales'

const props = defineProps<{
  contactId?: string
  dealId?: string
  scope?: 'mine' | 'all'
  compact?: boolean
}>()

const api = useApi()
const toMessage = useApiError()
const auth = useAuthStore()
const directory = useDirectoryStore()
const { locale } = useI18n()

const showDone = ref(false)
const tasks = ref<TaskInfo[]>([])
const error = ref<string | null>(null)

async function load() {
  tasks.value = (
    await api<{ tasks: TaskInfo[] }>('/tasks', {
      query: {
        scope: props.scope ?? 'mine',
        contactId: props.contactId,
        dealId: props.dealId,
        done: showDone.value ? undefined : 'false',
      },
    })
  ).tasks
}
watch([showDone, () => props.scope], () => void load())
onMounted(() => {
  void load()
  void directory.load()
})
defineExpose({ load })

const dateFmt = computed(
  () => new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }),
)
const overdue = (t: TaskInfo) => !t.done && t.dueAt && new Date(t.dueAt) < new Date()

const draft = reactive({ title: '', dueAt: '', assigneeId: '' })
async function add() {
  error.value = null
  try {
    await api('/tasks', {
      method: 'POST',
      body: {
        title: draft.title,
        dueAt: draft.dueAt ? new Date(draft.dueAt).toISOString() : null,
        assigneeId: draft.assigneeId || null,
        contactId: props.contactId ?? null,
        dealId: props.dealId ?? null,
      },
    })
    Object.assign(draft, { title: '', dueAt: '', assigneeId: '' })
    await load()
  } catch (err) {
    error.value = toMessage(err)
  }
}

async function toggle(t: TaskInfo) {
  await api(`/tasks/${t.id}`, { method: 'PATCH', body: { done: !t.done } })
  await load()
}
async function remove(id: string) {
  await api(`/tasks/${id}`, { method: 'DELETE' })
  await load()
}
</script>

<template>
  <div class="space-y-3">
    <form v-if="auth.can('deals:edit')" class="flex flex-wrap gap-2" @submit.prevent="add">
      <input
        v-model="draft.title"
        class="input min-w-40 flex-1"
        required
        maxlength="200"
        :placeholder="$t('tasks.titleLabel')"
        dir="auto"
      />
      <input
        v-model="draft.dueAt"
        type="datetime-local"
        class="input ltr w-auto"
        :aria-label="$t('tasks.due')"
      />
      <select
        v-if="!compact"
        v-model="draft.assigneeId"
        class="input w-auto"
        :aria-label="$t('tasks.assignee')"
      >
        <option value="">{{ auth.user?.name }}</option>
        <option
          v-for="u in directory.assignable.filter((x) => x.id !== auth.user?.id)"
          :key="u.id"
          :value="u.id"
        >
          {{ u.name }}
        </option>
      </select>
      <button type="submit" class="btn-primary">{{ $t('tasks.add') }}</button>
    </form>
    <FormAlert :message="error" />

    <p v-if="!tasks.length" class="text-sm text-slate-500">{{ $t('tasks.empty') }}</p>
    <ul class="space-y-1.5">
      <li
        v-for="tk in tasks"
        :key="tk.id"
        class="flex items-start gap-3 rounded-xl border border-slate-200 px-3 py-2 text-sm dark:border-slate-800"
      >
        <input
          type="checkbox"
          class="mt-1 size-4 accent-brand-700"
          :checked="tk.done"
          :aria-label="tk.title"
          @change="toggle(tk)"
        />
        <div class="min-w-0 flex-1">
          <p :class="{ 'text-slate-400 line-through': tk.done }" dir="auto">{{ tk.title }}</p>
          <p class="mt-0.5 flex flex-wrap gap-x-2 text-xs text-slate-500">
            <span v-if="tk.dueAt" :class="{ 'font-semibold text-rose-600': overdue(tk) }">
              {{ overdue(tk) ? `${$t('tasks.overdue')} · ` : ''
              }}{{ dateFmt.format(new Date(tk.dueAt)) }}
            </span>
            <span v-if="!compact && tk.assignee">👤 {{ tk.assignee.name }}</span>
            <NuxtLink
              v-if="!compact && tk.contact"
              :to="`/contacts/${tk.contact.id}`"
              class="text-brand-700"
            >
              {{ tk.contact.name ?? tk.contact.waName ?? `+${tk.contact.waId}` }}
            </NuxtLink>
            <span v-if="!compact && tk.deal">· {{ tk.deal.title }}</span>
          </p>
        </div>
        <button
          v-if="auth.can('deals:edit')"
          type="button"
          class="text-xs text-rose-600"
          @click="remove(tk.id)"
        >
          ✕
        </button>
      </li>
    </ul>
    <label class="flex items-center gap-2 text-xs text-slate-500">
      <input v-model="showDone" type="checkbox" class="size-3.5 accent-brand-700" />
      {{ $t('tasks.showDone') }}
    </label>
  </div>
</template>
