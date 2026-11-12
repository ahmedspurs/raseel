<script setup lang="ts">
import { ArrowRight, Eye, PanelLeft, PenLine } from 'lucide-vue-next'
import type { ConversationSummary, PresenceViewer } from '~/types/inbox'

const props = defineProps<{
  conversation: ConversationSummary
  viewers: PresenceViewer[]
  panelOpen?: boolean
}>()
const emit = defineEmits<{ updated: [conversation: ConversationSummary]; togglePanel: [] }>()

const api = useApi()
const toMessage = useApiError()
const auth = useAuthStore()
const directory = useDirectoryStore()
const { locale } = useI18n()

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
  <header class="border-b border-slate-200 bg-white">
    <div class="flex min-h-16 flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 md:px-6">
      <NuxtLink
        to="/inbox"
        class="grid size-10 place-items-center rounded-lg text-slate-700 hover:bg-slate-100 md:hidden"
        :aria-label="$t('inbox.back')"
      >
        <ArrowRight class="size-5 ltr:-scale-x-100" :stroke-width="1.5" aria-hidden="true" />
      </NuxtLink>

      <div class="min-w-0 flex-1">
        <p class="truncate text-base font-semibold">
          {{ conversation.contact.name ?? `+${conversation.contact.waId}` }}
        </p>
        <p class="num ltr text-xs text-slate-500">{{ formatPhone(conversation.contact.waId) }}</p>
      </div>

      <div class="flex flex-wrap items-center gap-1.5">
        <label class="sr-only" for="hdr-assignee">{{ $t('inbox.assignee') }}</label>
        <select
          id="hdr-assignee"
          :value="conversation.assigneeId ?? ''"
          class="h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-[13px] font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-60"
          :disabled="!canAssign || busy"
          @change="onAssignee"
        >
          <option value="">{{ $t('inbox.unassigned') }}</option>
          <option v-for="u in directory.assignable" :key="u.id" :value="u.id">{{ u.name }}</option>
        </select>
        <label class="sr-only" for="hdr-team">{{ $t('inbox.team') }}</label>
        <select
          id="hdr-team"
          :value="conversation.teamId ?? ''"
          class="hidden h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-[13px] font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-60 lg:block"
          :disabled="!canAssign || busy"
          @change="onTeam"
        >
          <option value="">{{ $t('inbox.noTeam') }}</option>
          <option v-for="tm in directory.teams" :key="tm.id" :value="tm.id">{{ tm.name }}</option>
        </select>
        <button
          v-if="
            canAssign && conversation.assigneeId !== auth.user?.id && auth.user?.role !== 'VIEWER'
          "
          type="button"
          class="btn-ghost h-9 min-h-0 text-[13px]"
          :disabled="busy"
          @click="update({ assigneeId: auth.user!.id })"
        >
          {{ $t('inbox.assignToMe') }}
        </button>

        <template v-if="canReply">
          <button
            v-if="conversation.status === 'CLOSED' || conversation.status === 'PENDING'"
            type="button"
            class="btn-ghost h-9 min-h-0 text-[13px]"
            :disabled="busy"
            @click="update({ status: 'OPEN' })"
          >
            {{ $t('inbox.reopen') }}
          </button>
          <button
            v-if="conversation.status === 'OPEN'"
            type="button"
            class="btn-ghost h-9 min-h-0 text-[13px]"
            :disabled="busy"
            @click="update({ status: 'PENDING' })"
          >
            {{ $t('inbox.markPending') }}
          </button>
          <button
            v-if="conversation.status !== 'CLOSED'"
            type="button"
            class="btn-primary h-9 min-h-0 text-[13px]"
            :disabled="busy"
            @click="update({ status: 'CLOSED' })"
          >
            {{ $t('inbox.close') }}
          </button>
        </template>

        <button
          type="button"
          class="hidden size-9 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 xl:grid"
          :class="{ 'bg-slate-100 text-slate-900': panelOpen }"
          :title="$t('inbox.details')"
          :aria-label="$t('inbox.details')"
          :aria-pressed="panelOpen"
          @click="emit('togglePanel')"
        >
          <PanelLeft class="size-[18px]" :stroke-width="1.5" aria-hidden="true" />
        </button>
      </div>
    </div>

    <FormAlert v-if="error" :message="error" class="mx-4 mb-2" />

    <p
      v-if="typingNames.length"
      class="flex items-center gap-2 border-t border-amber-200 bg-amber-50 px-6 py-2 text-[13px] font-medium text-amber-900"
      role="status"
    >
      <PenLine class="size-4 shrink-0" :stroke-width="1.5" aria-hidden="true" />
      {{ $t('inbox.collision', { names: listFormat.format(typingNames) }) }}
    </p>
    <p
      v-else-if="viewingNames.length"
      class="flex items-center gap-2 border-t border-slate-100 px-6 py-1.5 text-xs text-slate-500"
      role="status"
    >
      <Eye class="size-3.5 shrink-0" :stroke-width="1.5" aria-hidden="true" />
      {{ $t('inbox.viewing', { names: listFormat.format(viewingNames) }) }}
    </p>
  </header>
</template>
