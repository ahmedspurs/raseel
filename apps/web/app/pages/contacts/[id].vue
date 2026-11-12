<script setup lang="ts">
import type { ContactInfo, CustomFieldDef, TagInfo } from '~/types/crm'
import type { ConversationSummary } from '~/types/inbox'

const route = useRoute()
const api = useApi()
const toMessage = useApiError()
const auth = useAuthStore()
const { t, locale } = useI18n()
const { shortDate } = useFormat()
const id = computed(() => String(route.params.id))

const {
  data,
  refresh,
  error: loadError,
} = await useAsyncData(`contact-${id.value}`, async () => {
  const [c, tags, fields] = await Promise.all([
    api<{ contact: ContactInfo; conversations: ConversationSummary[]; messageCount: number }>(
      `/contacts/${id.value}`,
    ),
    api<{ tags: TagInfo[] }>('/tags'),
    api<{ customFields: CustomFieldDef[] }>('/custom-fields'),
  ])
  return { ...c, tags: tags.tags, fields: fields.customFields }
})

useHead({ title: () => data.value?.contact.displayName ?? t('contacts.title') })

const canEdit = computed(() => auth.can('contacts:edit'))
const form = reactive({
  name: '',
  email: '',
  company: '',
  city: '',
  language: '' as '' | 'ar' | 'en',
  notes: '',
  tagIds: [] as string[],
  customFields: {} as Record<string, string>,
  optInMarketing: false,
})

function fillForm() {
  const c = data.value?.contact
  if (!c) return
  Object.assign(form, {
    name: c.name ?? '',
    email: c.email ?? '',
    company: c.company ?? '',
    city: c.city ?? '',
    language: c.language ?? '',
    notes: c.notes ?? '',
    tagIds: c.tags.map((x) => x.id),
    customFields: Object.fromEntries(
      Object.entries(c.customFields).map(([k, v]) => [k, String(v)]),
    ),
    optInMarketing: c.optInMarketing,
  })
}
watch(data, fillForm, { immediate: true })

const busy = ref(false)
const message = ref<{ text: string; tone: 'error' | 'success' } | null>(null)

async function save() {
  busy.value = true
  message.value = null
  try {
    await api(`/contacts/${id.value}`, {
      method: 'PATCH',
      body: {
        name: form.name || null,
        email: form.email || null,
        company: form.company || null,
        city: form.city || null,
        language: form.language || null,
        notes: form.notes || null,
        tagIds: form.tagIds,
        customFields: form.customFields,
        optInMarketing: form.optInMarketing,
      },
    })
    await refresh()
    message.value = { text: t('common.saved'), tone: 'success' }
  } catch (err) {
    message.value = { text: toMessage(err), tone: 'error' }
  } finally {
    busy.value = false
  }
}

function toggleTag(tagId: string) {
  const i = form.tagIds.indexOf(tagId)
  if (i >= 0) form.tagIds.splice(i, 1)
  else form.tagIds.push(tagId)
}

// ── Template ──
const showTemplate = ref(false)
async function onTemplateSent(conversationId: string) {
  showTemplate.value = false
  await navigateTo(`/inbox/${conversationId}`)
}

// ── Privacy (NFR-10) ──
const confirmText = ref('')
const deleting = ref(false)
async function remove() {
  deleting.value = true
  try {
    await api(`/contacts/${id.value}`, { method: 'DELETE' })
    await navigateTo('/contacts')
  } catch (err) {
    message.value = { text: toMessage(err), tone: 'error' }
  } finally {
    deleting.value = false
  }
}

const dateFmt = computed(() => new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' }))
</script>

<template>
  <div class="mx-auto max-w-5xl px-4 py-6 md:px-8 md:py-10">
    <p v-if="loadError" class="card p-6 text-center text-slate-500">{{ $t('errors.not_found') }}</p>

    <template v-else-if="data">
      <NuxtLink
        to="/contacts"
        class="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"
      >
        <span class="rtl:rotate-180">‹</span> {{ $t('contacts.title') }}
      </NuxtLink>

      <header class="card mb-6 flex flex-wrap items-center gap-4 p-5">
        <span
          class="grid size-14 place-items-center rounded-full bg-brand-100 text-lg font-bold text-brand-800"
        >
          {{ initials(data.contact.displayName) }}
        </span>
        <div class="min-w-0 flex-1">
          <h1 class="truncate text-xl font-bold">
            {{ data.contact.displayName ?? `+${data.contact.waId}` }}
          </h1>
          <p class="ltr text-sm text-slate-500">+{{ data.contact.waId }}</p>
          <p
            v-if="data.contact.waName && data.contact.waName !== data.contact.name"
            class="text-xs text-slate-500"
          >
            {{ $t('contacts.whatsappName', { name: data.contact.waName }) }}
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <NuxtLink
            v-if="data.conversations[0]"
            :to="`/inbox/${data.conversations[0].id}`"
            class="btn-secondary"
          >
            {{ $t('contacts.openConversation') }}
          </NuxtLink>
          <button
            v-if="auth.can('conversations:reply')"
            type="button"
            class="btn-primary"
            @click="showTemplate = true"
          >
            {{ $t('contacts.sendTemplate') }}
          </button>
        </div>
      </header>

      <div class="grid gap-6 lg:grid-cols-3">
        <form class="card space-y-4 p-6 lg:col-span-2" @submit.prevent="save">
          <h2 class="text-lg font-semibold">{{ $t('contacts.profile') }}</h2>
          <fieldset :disabled="!canEdit" class="grid gap-4 sm:grid-cols-2">
            <div>
              <label class="label" for="c-name">{{ $t('common.name') }}</label>
              <input id="c-name" v-model="form.name" class="input" maxlength="120" dir="auto" />
            </div>
            <div>
              <label class="label" for="c-email">{{ $t('common.email') }}</label>
              <input id="c-email" v-model="form.email" type="email" class="input ltr" />
            </div>
            <div>
              <label class="label" for="c-company">{{ $t('contacts.company') }}</label>
              <input
                id="c-company"
                v-model="form.company"
                class="input"
                maxlength="120"
                dir="auto"
              />
            </div>
            <div>
              <label class="label" for="c-city">{{ $t('contacts.city') }}</label>
              <input id="c-city" v-model="form.city" class="input" maxlength="80" dir="auto" />
            </div>
            <div>
              <label class="label" for="c-lang">{{ $t('common.language') }}</label>
              <select id="c-lang" v-model="form.language" class="input">
                <option value="">—</option>
                <option value="ar">العربية</option>
                <option value="en">English</option>
              </select>
            </div>

            <div v-for="f in data.fields" :key="f.id">
              <label class="label" :for="`cf-${f.key}`">{{ f.label }}</label>
              <select
                v-if="f.type === 'SELECT'"
                :id="`cf-${f.key}`"
                v-model="form.customFields[f.key]"
                class="input"
              >
                <option value="">—</option>
                <option v-for="o in f.options" :key="o" :value="o">{{ o }}</option>
              </select>
              <input
                v-else
                :id="`cf-${f.key}`"
                v-model="form.customFields[f.key]"
                class="input"
                :class="{ ltr: f.type !== 'TEXT' }"
                :type="f.type === 'NUMBER' ? 'number' : f.type === 'DATE' ? 'date' : 'text'"
                dir="auto"
              />
            </div>

            <div class="sm:col-span-2">
              <span class="label">{{ $t('contacts.tags') }}</span>
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="tg in data.tags"
                  :key="tg.id"
                  type="button"
                  class="rounded-full border px-3 py-1 text-sm transition"
                  :style="
                    form.tagIds.includes(tg.id)
                      ? { backgroundColor: tg.color, borderColor: tg.color, color: '#fff' }
                      : { borderColor: tg.color, color: tg.color }
                  "
                  :aria-pressed="form.tagIds.includes(tg.id)"
                  @click="toggleTag(tg.id)"
                >
                  {{ tg.name }}
                </button>
                <NuxtLink
                  v-if="auth.can('tags:manage')"
                  to="/settings/tags"
                  class="px-2 py-1 text-sm text-brand-700"
                  >+</NuxtLink
                >
              </div>
            </div>

            <div class="sm:col-span-2">
              <label class="label" for="c-notes">{{ $t('contacts.notes') }}</label>
              <textarea
                id="c-notes"
                v-model="form.notes"
                class="input min-h-24"
                maxlength="5000"
                dir="auto"
              />
            </div>

            <label class="flex items-start gap-3 sm:col-span-2">
              <input
                v-model="form.optInMarketing"
                type="checkbox"
                class="mt-1 size-4 accent-brand-700"
              />
              <span>
                <span class="font-medium">{{ $t('contacts.optIn') }}</span>
                <span class="block text-xs text-slate-500">
                  {{ $t('contacts.consentHelp') }}
                  <template v-if="data.contact.optInMarketing && data.contact.optedInAt">
                    ·
                    {{
                      $t('contacts.consentSince', {
                        date: dateFmt.format(new Date(data.contact.optedInAt)),
                      })
                    }}
                  </template>
                </span>
              </span>
            </label>
          </fieldset>
          <FormAlert :message="message?.text" :tone="message?.tone" />
          <button v-if="canEdit" type="submit" class="btn-primary" :disabled="busy">
            {{ $t('common.save') }}
          </button>
        </form>

        <aside class="space-y-6">
          <section class="card p-5">
            <h2 class="mb-1 font-semibold">{{ $t('contacts.conversations') }}</h2>
            <p class="mb-3 text-xs text-slate-500">
              {{ $t('contacts.messages', { n: data.messageCount }) }}
            </p>
            <ul class="space-y-2">
              <li v-for="c in data.conversations" :key="c.id">
                <NuxtLink
                  :to="`/inbox/${c.id}`"
                  class="block rounded-xl border border-slate-200 p-3 text-sm hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800"
                >
                  <span class="flex justify-between gap-2">
                    <span class="badge bg-slate-100 text-slate-700">{{
                      $t(`inbox.statusLabel.${c.status}`)
                    }}</span>
                    <span class="text-xs text-slate-500">{{ shortDate(c.lastMessageAt) }}</span>
                  </span>
                  <span class="mt-1 line-clamp-2 block text-slate-600" dir="auto">{{
                    c.lastMessagePreview
                  }}</span>
                </NuxtLink>
              </li>
            </ul>
          </section>

          <section v-if="auth.can('data:export')" class="card space-y-3 p-5">
            <h2 class="font-semibold">{{ $t('contacts.privacy') }}</h2>
            <div>
              <a
                :href="`/api/contacts/${data.contact.id}/export`"
                class="btn-secondary w-full"
                download
                >{{ $t('contacts.export') }}</a
              >
              <p class="mt-1 text-xs text-slate-500">{{ $t('contacts.exportHelp') }}</p>
            </div>
            <div class="rounded-xl border border-rose-200 p-3 dark:border-rose-900">
              <p class="text-xs text-rose-800 dark:text-rose-200">
                {{ $t('contacts.deleteHelp') }}
              </p>
              <input
                v-model="confirmText"
                class="input ltr mt-2 py-1.5"
                :placeholder="$t('contacts.deleteConfirm')"
              />
              <button
                type="button"
                class="btn-danger mt-2 w-full"
                :disabled="confirmText !== 'DELETE' || deleting"
                @click="remove"
              >
                {{ $t('contacts.delete') }}
              </button>
            </div>
          </section>
        </aside>
      </div>

      <TemplateSender
        v-if="showTemplate"
        :contact="data.contact"
        @close="showTemplate = false"
        @sent="onTemplateSent"
      />
    </template>
  </div>
</template>
