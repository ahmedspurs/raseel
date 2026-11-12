<script setup lang="ts">
import { customerWindow } from '@raseel/shared'
import type { ConversationSummary, PresenceViewer } from '~/types/inbox'

const props = defineProps<{ conversation: ConversationSummary; viewers: PresenceViewer[] }>()
const emit = defineEmits<{ updated: [conversation: ConversationSummary] }>()

const api = useApi()
const toMessage = useApiError()
const auth = useAuthStore()
const directory = useDirectoryStore()
const { duration } = useFormat()
const { locale } = useI18n()

const now = ref(Date.now())
const clock = setInterval(() => (now.value = Date.now()), 30_000)
onBeforeUnmount(() => clearInterval(clock))

const windowState = computed(() =>
  customerWindow(props.conversation.lastInboundAt, new Date(now.value)),
)
const canAssign = computed(() => auth.can('conversations:assign'))
const canReply = computed(() => auth.can('conversations:reply'))
const error = ref<string | null>(null)
const busy = ref(false)

/** Other people in this conversation (FR-19). */
const others = computed(() => props.viewers.filter((v) => v.userId !== auth.user?.id))
const typingNames = computed(() => others.value.filter((v) => v.typing).map((v) => v.name))
const viewingNames = computed(() => others.value.filter((v) => !v.typing).map((v) => v.name))
const listFormat = computed(() => new Intl.ListFormat(locale.value, { type: 'conjunction' }))

async function update(body: Record<string, unknown>) {
  busy.value = true
  error.value = null
  try {
    const res = await api<{ conversation: ConversationSummary }>(
      `/conversations/${props.conversation.id}`,
      { method: 'PATCH', body },
    )
    emit('updated', res.conversation)
  } catch (err) {
    error.value = toMessage(err)
  } finally {
    busy.value = false
  }
}

function onAssignee(e: Event) {
  const v = (e.target as HTMLSelectElement).value
  void update({ assigneeId: v || null })
}
function onTeam(e: Event) {
  const v = (e.target as HTMLSelectElement).value
  void update({ teamId: v || null })
}
</script>

<template>
  <header class="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
    <div class="flex items-center gap-3 px-4 py-3">
      <NuxtLink
        to="/inbox"
        class="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 md:hidden"
        :aria-label="$t('inbox.back')"
      >
        <svg
          viewBox="0 0 24 24"
          class="size-5 rtl:rotate-180"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="m15 18-6-6 6-6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </NuxtLink>
      <span
        class="grid size-10 shrink-0 place-items-center rounded-full bg-slate-200 text-sm font-semibold dark:bg-slate-700"
      >
        {{ initials(conversation.contact.name) }}
      </span>
      <div class="min-w-0 flex-1">
        <p class="truncate font-semibold">
          {{ conversation.contact.name ?? `+${conversation.contact.waId}` }}
        </p>
        <p class="ltr text-xs text-slate-500">+{{ conversation.contact.waId }}</p>
      </div>
      <span
        class="badge hidden lg:inline-flex"
        :class="
          windowState.open ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
        "
      >
        {{
          windowState.open
            ? $t('inbox.windowOpen', { time: duration(windowState.remainingMs) })
            : $t('inbox.windowClosedShort')
        }}
      </span>
    </div>

    <div
      class="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-2 text-sm dark:border-slate-800"
    >
      <label class="flex items-center gap-1.5">
        <span class="text-xs text-slate-500">{{ $t('inbox.assignee') }}</span>
        <select
          :value="conversation.assigneeId ?? ''"
          class="input w-auto py-1 text-sm"
          :disabled="!canAssign || busy"
          @change="onAssignee"
        >
          <option value="">{{ $t('inbox.unassigned') }}</option>
          <option v-for="u in directory.assignable" :key="u.id" :value="u.id">{{ u.name }}</option>
        </select>
      </label>
      <button
        v-if="
          canAssign && conversation.assigneeId !== auth.user?.id && auth.user?.role !== 'VIEWER'
        "
        type="button"
        class="text-xs font-semibold text-brand-700 hover:underline"
        :disabled="busy"
        @click="update({ assigneeId: auth.user!.id })"
      >
        {{ $t('inbox.assignToMe') }}
      </button>
      <label class="flex items-center gap-1.5">
        <span class="text-xs text-slate-500">{{ $t('inbox.team') }}</span>
        <select
          :value="conversation.teamId ?? ''"
          class="input w-auto py-1 text-sm"
          :disabled="!canAssign || busy"
          @change="onTeam"
        >
          <option value="">{{ $t('inbox.noTeam') }}</option>
          <option v-for="tm in directory.teams" :key="tm.id" :value="tm.id">{{ tm.name }}</option>
        </select>
      </label>

      <div v-if="canReply" class="ms-auto flex items-center gap-1.5">
        <template v-if="conversation.status === 'CLOSED'">
          <button
            type="button"
            class="btn-secondary py-1 text-xs"
            :disabled="busy"
            @click="update({ status: 'OPEN' })"
          >
            {{ $t('inbox.reopen') }}
          </button>
        </template>
        <template v-else>
          <button
            v-if="conversation.status === 'OPEN'"
            type="button"
            class="btn-secondary py-1 text-xs"
            :disabled="busy"
            @click="update({ status: 'PENDING' })"
          >
            {{ $t('inbox.markPending') }}
          </button>
          <button
            v-else
            type="button"
            class="btn-secondary py-1 text-xs"
            :disabled="busy"
            @click="update({ status: 'OPEN' })"
          >
            {{ $t('inbox.reopen') }}
          </button>
          <button
            type="button"
            class="btn-primary py-1 text-xs"
            :disabled="busy"
            @click="update({ status: 'CLOSED' })"
          >
            {{ $t('inbox.close') }}
          </button>
        </template>
      </div>
    </div>

    <FormAlert v-if="error" :message="error" class="mx-4 mb-2" />

    <p
      v-if="typingNames.length"
      class="border-t border-amber-200 bg-amber-50 px-4 py-1.5 text-xs font-medium text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
      role="status"
    >
      ⚠️ {{ $t('inbox.collision', { names: listFormat.format(typingNames) }) }}
    </p>
    <p
      v-else-if="viewingNames.length"
      class="border-t border-slate-100 px-4 py-1.5 text-xs text-slate-500 dark:border-slate-800"
      role="status"
    >
      👀 {{ $t('inbox.viewing', { names: listFormat.format(viewingNames) }) }}
    </p>
  </header>
</template>
