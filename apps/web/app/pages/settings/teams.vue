<script setup lang="ts">
definePageMeta({ middleware: [() => (useAuthStore().can('teams:manage') ? undefined : navigateTo('/settings'))] })

interface Team {
  id: string
  name: string
  memberIds: string[]
}
interface Member {
  id: string
  name: string
  active: boolean
}

const api = useApi()
const toMessage = useApiError()

const { data: teams, refresh } = await useAsyncData('teams', () =>
  api<{ teams: Team[] }>('/teams').then((r) => r.teams),
)
const { data: users } = await useAsyncData('team-users', () =>
  api<{ users: Member[] }>('/users').then((r) => r.users.filter((u) => u.active)),
)

const editing = ref<{ id: string | null; name: string; memberIds: string[] } | null>(null)
const busy = ref(false)
const error = ref<string | null>(null)

const userName = (id: string) => users.value?.find((u) => u.id === id)?.name ?? '—'

function startNew() {
  editing.value = { id: null, name: '', memberIds: [] }
}

function startEdit(team: Team) {
  editing.value = { id: team.id, name: team.name, memberIds: [...team.memberIds] }
}

async function save() {
  if (!editing.value) return
  busy.value = true
  error.value = null
  const { id, ...body } = editing.value
  try {
    await api(id ? `/teams/${id}` : '/teams', { method: id ? 'PUT' : 'POST', body })
    editing.value = null
    await refresh()
  } catch (err) {
    error.value = toMessage(err)
  } finally {
    busy.value = false
  }
}

async function remove(id: string) {
  await api(`/teams/${id}`, { method: 'DELETE' })
  await refresh()
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <h2 class="text-lg font-semibold">{{ $t('settings.teams') }}</h2>
      <button type="button" class="btn-primary" @click="startNew">{{ $t('settings.newTeam') }}</button>
    </div>

    <form v-if="editing" class="card space-y-4 p-6" @submit.prevent="save">
      <div>
        <label class="label" for="tname">{{ $t('settings.teamName') }}</label>
        <input id="tname" v-model="editing.name" class="input" required maxlength="80" autofocus>
      </div>
      <fieldset>
        <legend class="label">{{ $t('settings.members') }}</legend>
        <div class="grid gap-2 sm:grid-cols-2">
          <label
            v-for="u in users"
            :key="u.id"
            class="flex items-center gap-2.5 rounded-xl border border-slate-200 px-3 py-2 text-sm dark:border-slate-800"
          >
            <input v-model="editing.memberIds" type="checkbox" :value="u.id" class="size-4 accent-brand-700">
            {{ u.name }}
          </label>
        </div>
      </fieldset>
      <FormAlert :message="error" />
      <div class="flex gap-3">
        <button type="button" class="btn-secondary" @click="editing = null">{{ $t('common.cancel') }}</button>
        <button type="submit" class="btn-primary" :disabled="busy">{{ $t('common.save') }}</button>
      </div>
    </form>

    <p v-if="!teams?.length && !editing" class="card p-6 text-center text-sm text-slate-600 dark:text-slate-400">
      {{ $t('settings.noTeams') }}
    </p>

    <ul v-else class="grid gap-4 sm:grid-cols-2">
      <li v-for="team in teams" :key="team.id" class="card p-5">
        <div class="flex items-start justify-between gap-3">
          <h3 class="font-semibold">{{ team.name }}</h3>
          <div class="flex gap-3 text-sm">
            <button type="button" class="font-medium text-brand-700" @click="startEdit(team)">{{ $t('common.edit') }}</button>
            <button type="button" class="font-medium text-rose-600" @click="remove(team.id)">{{ $t('common.delete') }}</button>
          </div>
        </div>
        <p class="mt-2 text-sm text-slate-600 dark:text-slate-400">
          {{ team.memberIds.map(userName).join('، ') || '—' }}
        </p>
      </li>
    </ul>
  </div>
</template>
