<script setup lang="ts">
import { MessageSquare, Tag, UserRound, Users } from 'lucide-vue-next'
import type { AutomationSettings } from '@raseel/shared'
import type { TagInfo } from '~/types/crm'

definePageMeta({
  middleware: [
    () => (useAuthStore().can('automations:manage') ? undefined : navigateTo('/settings')),
  ],
})

interface Rule {
  id: string
  name: string
  keywords: string[]
  match: 'CONTAINS' | 'EXACT'
  actions: {
    tagId?: string | null
    assigneeId?: string | null
    teamId?: string | null
    reply?: string | null
  }
  active: boolean
}

const api = useApi()
const toMessage = useApiError()
const { t } = useI18n()
const directory = useDirectoryStore()

const { data, refresh } = await useAsyncData('automation', async () => {
  const [s, r, tg] = await Promise.all([
    api<{ automation: AutomationSettings }>('/automation/settings'),
    api<{ rules: Rule[] }>('/automation/rules'),
    api<{ tags: TagInfo[] }>('/tags'),
  ])
  return { settings: s.automation, rules: r.rules, tags: tg.tags }
})
await directory.load()

const settings = reactive<AutomationSettings>(structuredClone(toRaw(data.value!.settings)))
const settingsMessage = ref<{ text: string; tone: 'error' | 'success' } | null>(null)
async function saveSettings() {
  settingsMessage.value = null
  try {
    await api('/automation/settings', {
      method: 'PUT',
      body: {
        ...settings,
        welcome: { ...settings.welcome, buttons: settings.welcome.buttons.filter(Boolean) },
      },
    })
    settingsMessage.value = { text: t('common.saved'), tone: 'success' }
  } catch (err) {
    settingsMessage.value = { text: toMessage(err), tone: 'error' }
  }
}

// ── Rules ──
type Draft = {
  id: string | null
  name: string
  keywords: string
  match: 'CONTAINS' | 'EXACT'
  tagId: string
  assigneeId: string
  teamId: string
  reply: string
  active: boolean
}
const editing = ref<Draft | null>(null)
const ruleError = ref<string | null>(null)

function newRule() {
  editing.value = {
    id: null,
    name: '',
    keywords: '',
    match: 'CONTAINS',
    tagId: '',
    assigneeId: '',
    teamId: '',
    reply: '',
    active: true,
  }
}
function editRule(r: Rule) {
  editing.value = {
    id: r.id,
    name: r.name,
    keywords: r.keywords.join('، '),
    match: r.match,
    tagId: r.actions.tagId ?? '',
    assigneeId: r.actions.assigneeId ?? '',
    teamId: r.actions.teamId ?? '',
    reply: r.actions.reply ?? '',
    active: r.active,
  }
}
async function saveRule() {
  const d = editing.value
  if (!d) return
  ruleError.value = null
  try {
    await api(d.id ? `/automation/rules/${d.id}` : '/automation/rules', {
      method: d.id ? 'PUT' : 'POST',
      body: {
        name: d.name,
        keywords: d.keywords
          .split(/[,،\n]/)
          .map((k) => k.trim())
          .filter(Boolean),
        match: d.match,
        active: d.active,
        actions: {
          tagId: d.tagId || null,
          assigneeId: d.assigneeId || null,
          teamId: d.teamId || null,
          reply: d.reply || null,
        },
      },
    })
    editing.value = null
    await refresh()
  } catch (err) {
    ruleError.value = toMessage(err)
  }
}
async function removeRule(id: string) {
  await api(`/automation/rules/${id}`, { method: 'DELETE' })
  await refresh()
}
const tagName = (id?: string | null) => data.value?.tags.find((x) => x.id === id)?.name
</script>

<template>
  <div class="space-y-6">
    <form class="card space-y-5 p-6" @submit.prevent="saveSettings">
      <section class="space-y-3">
        <label class="flex items-center gap-3">
          <input
            v-model="settings.workingHours.enabled"
            type="checkbox"
            class="size-4 accent-brand-700"
          />
          <span class="text-lg font-semibold">{{ $t('automation.workingHours') }}</span>
        </label>
        <p class="text-sm text-slate-500">{{ $t('automation.workingHoursHelp') }}</p>
        <div v-if="settings.workingHours.enabled" class="space-y-2">
          <div
            v-for="(day, i) in settings.workingHours.days"
            :key="i"
            class="flex flex-wrap items-center gap-3 text-sm"
          >
            <label class="flex w-32 items-center gap-2">
              <input v-model="day.open" type="checkbox" class="size-4 accent-brand-700" />
              {{ $t(`automation.days.${i}`) }}
            </label>
            <template v-if="day.open">
              <input v-model="day.start" type="time" class="input ltr w-auto py-1.5" />
              <span>–</span>
              <input v-model="day.end" type="time" class="input ltr w-auto py-1.5" />
            </template>
            <span v-else class="text-slate-400">{{ $t('automation.closed') }}</span>
          </div>
          <div>
            <label class="label" for="away">{{ $t('automation.awayMessage') }}</label>
            <textarea
              id="away"
              v-model="settings.workingHours.awayMessage"
              class="input min-h-20"
              maxlength="1024"
              dir="auto"
            />
          </div>
        </div>
      </section>

      <section class="space-y-3 border-t border-slate-100 pt-5 dark:border-slate-800">
        <label class="flex items-center gap-3">
          <input
            v-model="settings.welcome.enabled"
            type="checkbox"
            class="size-4 accent-brand-700"
          />
          <span class="text-lg font-semibold">{{ $t('automation.welcome') }}</span>
        </label>
        <p class="text-sm text-slate-500">{{ $t('automation.welcomeHelp') }}</p>
        <template v-if="settings.welcome.enabled">
          <textarea
            v-model="settings.welcome.message"
            class="input min-h-20"
            maxlength="1024"
            dir="auto"
          />
          <div>
            <span class="label">{{ $t('automation.welcomeButtons') }}</span>
            <div class="flex flex-wrap gap-2">
              <input
                v-for="i in 3"
                :key="i"
                v-model="settings.welcome.buttons[i - 1]"
                class="input w-40"
                maxlength="20"
                dir="auto"
              />
            </div>
          </div>
        </template>
      </section>

      <FormAlert :message="settingsMessage?.text" :tone="settingsMessage?.tone" />
      <button type="submit" class="btn-primary">{{ $t('common.save') }}</button>
    </form>

    <section class="card space-y-4 p-6">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 class="text-lg font-semibold">{{ $t('automation.rules') }}</h2>
          <p class="text-sm text-slate-500">{{ $t('automation.rulesHelp') }}</p>
        </div>
        <button type="button" class="btn-primary" @click="newRule">
          {{ $t('automation.newRule') }}
        </button>
      </div>

      <form
        v-if="editing"
        class="grid gap-3 rounded-xl border border-slate-200 p-4 sm:grid-cols-2 dark:border-slate-800"
        @submit.prevent="saveRule"
      >
        <div>
          <label class="label" for="r-name">{{ $t('automation.ruleName') }}</label>
          <input
            id="r-name"
            v-model="editing.name"
            class="input"
            required
            maxlength="80"
            dir="auto"
          />
        </div>
        <div>
          <label class="label" for="r-match">{{ $t('automation.match') }}</label>
          <select id="r-match" v-model="editing.match" class="input">
            <option value="CONTAINS">{{ $t('automation.contains') }}</option>
            <option value="EXACT">{{ $t('automation.exact') }}</option>
          </select>
        </div>
        <div class="sm:col-span-2">
          <label class="label" for="r-kw">{{ $t('automation.keywords') }}</label>
          <input id="r-kw" v-model="editing.keywords" class="input" required dir="auto" />
        </div>
        <div>
          <label class="label" for="r-tag">{{ $t('automation.thenTag') }}</label>
          <select id="r-tag" v-model="editing.tagId" class="input">
            <option value="">{{ $t('automation.none') }}</option>
            <option v-for="tg in data?.tags" :key="tg.id" :value="tg.id">{{ tg.name }}</option>
          </select>
        </div>
        <div>
          <label class="label" for="r-user">{{ $t('automation.thenAssign') }}</label>
          <select id="r-user" v-model="editing.assigneeId" class="input">
            <option value="">{{ $t('automation.none') }}</option>
            <option v-for="u in directory.assignable" :key="u.id" :value="u.id">
              {{ u.name }}
            </option>
          </select>
        </div>
        <div>
          <label class="label" for="r-team">{{ $t('automation.thenTeam') }}</label>
          <select id="r-team" v-model="editing.teamId" class="input">
            <option value="">{{ $t('automation.none') }}</option>
            <option v-for="tm in directory.teams" :key="tm.id" :value="tm.id">{{ tm.name }}</option>
          </select>
        </div>
        <label class="flex items-center gap-2 self-end text-sm">
          <input v-model="editing.active" type="checkbox" class="size-4 accent-brand-700" />
          {{ $t('automation.active') }}
        </label>
        <div class="sm:col-span-2">
          <label class="label" for="r-reply">{{ $t('automation.thenReply') }}</label>
          <textarea
            id="r-reply"
            v-model="editing.reply"
            class="input min-h-20"
            maxlength="1024"
            dir="auto"
          />
        </div>
        <FormAlert :message="ruleError" class="sm:col-span-2" />
        <div class="flex gap-2 sm:col-span-2">
          <button type="button" class="btn-secondary" @click="editing = null">
            {{ $t('common.cancel') }}
          </button>
          <button type="submit" class="btn-primary">{{ $t('common.save') }}</button>
        </div>
      </form>

      <ul class="divide-y divide-slate-100 dark:divide-slate-800">
        <li
          v-for="r in data?.rules"
          :key="r.id"
          class="flex flex-wrap items-start gap-3 py-3"
          :class="{ 'opacity-50': !r.active }"
        >
          <div class="min-w-0 flex-1">
            <p class="font-medium" dir="auto">{{ r.name }}</p>
            <p class="text-sm text-slate-600" dir="auto">
              {{ r.match === 'EXACT' ? $t('automation.exact') : $t('automation.contains') }}:
              {{ r.keywords.join('، ') }}
            </p>
            <p class="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
              <span v-if="r.actions.tagId" class="flex items-center gap-1"
                ><Tag class="size-3.5" :stroke-width="1.5" aria-hidden="true" />{{
                  tagName(r.actions.tagId)
                }}</span
              >
              <span v-if="r.actions.assigneeId" class="flex items-center gap-1"
                ><UserRound class="size-3.5" :stroke-width="1.5" aria-hidden="true" />{{
                  directory.userName(r.actions.assigneeId)
                }}</span
              >
              <span v-if="r.actions.teamId" class="flex items-center gap-1"
                ><Users class="size-3.5" :stroke-width="1.5" aria-hidden="true" />{{
                  directory.teamName(r.actions.teamId)
                }}</span
              >
              <span v-if="r.actions.reply" class="flex min-w-0 items-center gap-1" dir="auto"
                ><MessageSquare class="size-3.5" :stroke-width="1.5" aria-hidden="true" />{{
                  r.actions.reply
                }}</span
              >
            </p>
          </div>
          <button type="button" class="text-sm font-medium text-brand-700" @click="editRule(r)">
            {{ $t('common.edit') }}
          </button>
          <button type="button" class="text-sm font-medium text-rose-600" @click="removeRule(r.id)">
            {{ $t('common.delete') }}
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>
