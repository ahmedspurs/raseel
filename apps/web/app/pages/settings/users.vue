<script setup lang="ts">
import { canAssignRole, type Role } from '@raseel/shared'
import type { CurrentUser } from '~/stores/auth'

definePageMeta({
  middleware: [() => (useAuthStore().can('users:manage') ? undefined : navigateTo('/settings'))],
})

type Member = CurrentUser & { lastLoginAt: string | null; teamIds: string[] }
interface Invitation {
  id: string
  email: string
  name: string
  role: Role
  expiresAt: string
}

const api = useApi()
const toMessage = useApiError()
const auth = useAuthStore()
const { t, locale } = useI18n()

const { data: users, refresh: refreshUsers } = await useAsyncData('users', () =>
  api<{ users: Member[] }>('/users').then((r) => r.users),
)
const { data: invitations, refresh: refreshInvites } = await useAsyncData('invitations', () =>
  api<{ invitations: Invitation[] }>('/users/invitations').then((r) => r.invitations),
)

const assignableRoles = computed(() =>
  (['ADMIN', 'AGENT', 'VIEWER'] as const).filter(
    (r) => auth.user && canAssignRole(auth.user.role, r),
  ),
)

const showInvite = ref(false)
const invite = reactive({ name: '', email: '', role: 'AGENT' as Role })
const inviteBusy = ref(false)
const inviteError = ref<string | null>(null)
const inviteResult = ref<{ link: string; emailed: boolean } | null>(null)
const copied = ref(false)
const rowError = ref<string | null>(null)

const dateFmt = computed(
  () => new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }),
)

async function sendInvite() {
  inviteBusy.value = true
  inviteError.value = null
  try {
    inviteResult.value = await api<{ link: string; emailed: boolean }>('/users/invitations', {
      method: 'POST',
      body: invite,
    })
    invite.name = ''
    invite.email = ''
    await refreshInvites()
  } catch (err) {
    inviteError.value = toMessage(err)
  } finally {
    inviteBusy.value = false
  }
}

async function copyLink() {
  if (!inviteResult.value) return
  await navigator.clipboard.writeText(inviteResult.value.link)
  copied.value = true
  setTimeout(() => (copied.value = false), 2000)
}

async function revoke(id: string) {
  await api(`/users/invitations/${id}`, { method: 'DELETE' })
  await refreshInvites()
}

async function update(user: Member, body: { role?: Role; active?: boolean }) {
  rowError.value = null
  try {
    await api(`/users/${user.id}`, { method: 'PATCH', body })
    await refreshUsers()
  } catch (err) {
    rowError.value = toMessage(err)
  }
}

function editable(user: Member) {
  return user.id !== auth.user?.id && auth.user && canAssignRole(auth.user.role, user.role)
}

function closeInvite() {
  showInvite.value = false
  inviteResult.value = null
  inviteError.value = null
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center justify-between">
      <h2 class="text-lg font-semibold">{{ $t('settings.users') }}</h2>
      <button type="button" class="btn-primary" @click="showInvite = true">
        {{ $t('settings.invite') }}
      </button>
    </div>

    <div v-if="showInvite" class="card space-y-4 p-6">
      <template v-if="!inviteResult">
        <form class="grid gap-4 sm:grid-cols-3" @submit.prevent="sendInvite">
          <div>
            <label class="label" for="iname">{{ $t('common.name') }}</label>
            <input id="iname" v-model="invite.name" class="input" required maxlength="120" />
          </div>
          <div>
            <label class="label" for="iemail">{{ $t('common.email') }}</label>
            <input id="iemail" v-model="invite.email" type="email" class="input ltr" required />
          </div>
          <div>
            <label class="label" for="irole">{{ $t('common.role') }}</label>
            <select id="irole" v-model="invite.role" class="input">
              <option v-for="r in assignableRoles" :key="r" :value="r">
                {{ $t(`roles.${r}`) }}
              </option>
            </select>
          </div>
          <FormAlert class="sm:col-span-3" :message="inviteError" />
          <div class="flex gap-3 sm:col-span-3">
            <button type="button" class="btn-secondary" @click="closeInvite">
              {{ $t('common.cancel') }}
            </button>
            <button type="submit" class="btn-primary" :disabled="inviteBusy">
              {{ $t('settings.invite') }}
            </button>
          </div>
        </form>
      </template>
      <template v-else>
        <FormAlert
          v-if="inviteResult.emailed"
          tone="success"
          :message="$t('settings.inviteSent')"
        />
        <p class="text-sm text-slate-600 dark:text-slate-400">{{ $t('settings.inviteLink') }}</p>
        <div class="flex gap-2">
          <code class="input ltr select-all truncate font-mono text-xs">{{
            inviteResult.link
          }}</code>
          <button type="button" class="btn-secondary" @click="copyLink">
            {{ copied ? $t('common.copied') : $t('common.copy') }}
          </button>
        </div>
        <button type="button" class="btn-secondary" @click="closeInvite">
          {{ $t('common.cancel') }}
        </button>
      </template>
    </div>

    <FormAlert :message="rowError" />

    <div class="card overflow-x-auto">
      <table class="w-full text-sm">
        <thead
          class="border-b border-slate-200 text-start text-xs uppercase text-slate-500 dark:border-slate-800"
        >
          <tr>
            <th class="px-4 py-3 text-start font-medium">{{ $t('common.name') }}</th>
            <th class="px-4 py-3 text-start font-medium">{{ $t('common.role') }}</th>
            <th class="px-4 py-3 text-start font-medium">{{ $t('settings.lastLogin') }}</th>
            <th class="px-4 py-3 text-start font-medium">{{ $t('common.status') }}</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
          <tr v-for="u in users" :key="u.id" :class="{ 'opacity-60': !u.active }">
            <td class="px-4 py-3">
              <p class="font-medium">{{ u.name }}</p>
              <p class="ltr text-xs text-slate-500">{{ u.email }}</p>
            </td>
            <td class="px-4 py-3">
              <select
                v-if="editable(u)"
                :value="u.role"
                class="input max-w-36 py-1.5"
                @change="update(u, { role: ($event.target as HTMLSelectElement).value as Role })"
              >
                <option v-for="r in assignableRoles" :key="r" :value="r">
                  {{ $t(`roles.${r}`) }}
                </option>
              </select>
              <span v-else class="badge bg-brand-50 text-brand-800">{{
                $t(`roles.${u.role}`)
              }}</span>
            </td>
            <td class="px-4 py-3 text-slate-600 dark:text-slate-400">
              {{ u.lastLoginAt ? dateFmt.format(new Date(u.lastLoginAt)) : $t('common.never') }}
            </td>
            <td class="px-4 py-3">
              <button
                v-if="editable(u)"
                type="button"
                class="text-sm font-medium"
                :class="
                  u.active
                    ? 'text-rose-600 hover:text-rose-700'
                    : 'text-brand-700 hover:text-brand-800'
                "
                @click="update(u, { active: !u.active })"
              >
                {{ u.active ? $t('settings.deactivate') : $t('settings.activate') }}
              </button>
              <span v-else class="text-slate-500">{{
                u.active ? $t('common.active') : $t('common.inactive')
              }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <section v-if="invitations?.length" class="space-y-3">
      <h3 class="font-semibold">{{ $t('settings.pendingInvites') }}</h3>
      <ul class="card divide-y divide-slate-100 dark:divide-slate-800">
        <li
          v-for="i in invitations"
          :key="i.id"
          class="flex items-center justify-between gap-3 px-4 py-3 text-sm"
        >
          <div>
            <p class="font-medium">{{ i.name }} · {{ $t(`roles.${i.role}`) }}</p>
            <p class="ltr text-xs text-slate-500">{{ i.email }}</p>
          </div>
          <button
            type="button"
            class="text-sm font-medium text-rose-600 hover:text-rose-700"
            @click="revoke(i.id)"
          >
            {{ $t('common.delete') }}
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>
