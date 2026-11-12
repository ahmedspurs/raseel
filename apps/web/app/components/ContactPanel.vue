<script setup lang="ts">
import { ArrowUpLeft } from 'lucide-vue-next'
import type { ContactInfo, CustomFieldDef } from '~/types/crm'
import type { DealInfo, PipelineInfo } from '~/types/sales'

const props = defineProps<{ contactId: string }>()

const api = useApi()
const money = useMoney()
const { locale } = useI18n()

const contact = ref<ContactInfo | null>(null)
const fields = ref<CustomFieldDef[]>([])
const deals = ref<DealInfo[]>([])
const stages = ref<{ id: string; name: string }[]>([])

async function load() {
  const [c, f, d, p] = await Promise.all([
    api<{ contact: ContactInfo }>(`/contacts/${props.contactId}`),
    api<{ customFields: CustomFieldDef[] }>('/custom-fields'),
    api<{ deals: DealInfo[] }>('/deals', { query: { contactId: props.contactId } }),
    api<{ pipelines: PipelineInfo[] }>('/pipelines'),
  ])
  contact.value = c.contact
  fields.value = f.customFields
  deals.value = d.deals
  stages.value = p.pipelines.flatMap((x) => x.stages)
}
watch(
  () => props.contactId,
  () => void load(),
  { immediate: true },
)

const since = computed(() =>
  contact.value
    ? new Intl.DateTimeFormat(locale.value, { month: 'long', year: 'numeric' }).format(
        new Date(contact.value.createdAt),
      )
    : '',
)
const filledFields = computed(() =>
  fields.value
    .map((f) => ({ label: f.label, value: contact.value?.customFields[f.key] }))
    .filter((f) => f.value !== undefined && f.value !== ''),
)
const stageName = (id: string) => stages.value.find((s) => s.id === id)?.name ?? ''
</script>

<template>
  <aside
    v-if="contact"
    :aria-label="$t('inbox.details')"
    class="flex w-80 shrink-0 flex-col gap-6 overflow-y-auto border-s border-slate-200 bg-white px-5 py-6"
  >
    <div class="flex flex-col gap-3">
      <span
        class="grid size-12 place-items-center rounded-full bg-brand-100 text-base font-semibold text-raseel"
      >
        {{ initials(contact.displayName) }}
      </span>
      <div>
        <p class="text-[17px] font-semibold leading-7">
          {{ contact.displayName ?? `+${contact.waId}` }}
        </p>
        <p class="text-[13px] text-slate-500">
          <template v-if="contact.city">{{ contact.city }} · </template
          >{{ $t('inbox.customerSince', { date: since }) }}
        </p>
      </div>
    </div>

    <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 text-[13px]">
      <dt class="text-slate-500">{{ $t('contacts.phone') }}</dt>
      <dd class="num ltr truncate">{{ formatPhone(contact.waId) }}</dd>
      <template v-if="contact.email">
        <dt class="text-slate-500">{{ $t('common.email') }}</dt>
        <dd class="ltr truncate">{{ contact.email }}</dd>
      </template>
      <template v-if="contact.company">
        <dt class="text-slate-500">{{ $t('contacts.company') }}</dt>
        <dd class="truncate" dir="auto">{{ contact.company }}</dd>
      </template>
      <template v-for="f in filledFields" :key="f.label">
        <dt class="text-slate-500">{{ f.label }}</dt>
        <dd class="truncate" dir="auto">{{ f.value }}</dd>
      </template>
      <dt class="text-slate-500">{{ $t('inbox.marketing') }}</dt>
      <dd class="flex items-center gap-1.5">
        <span
          class="dot"
          :class="contact.optInMarketing ? 'bg-active' : 'border border-slate-400'"
          aria-hidden="true"
        />
        {{ contact.optInMarketing ? $t('inbox.consented') : $t('inbox.notConsented') }}
      </dd>
    </dl>

    <div v-if="contact.tags.length" class="flex flex-wrap gap-1.5">
      <span v-for="tg in contact.tags" :key="tg.id" class="badge">
        <span class="dot" :style="{ backgroundColor: tg.color }" aria-hidden="true" />{{ tg.name }}
      </span>
    </div>

    <section class="flex flex-col gap-2.5 border-t border-slate-100 pt-5">
      <h2 class="kicker">{{ $t('deals.title') }}</h2>
      <p v-if="!deals.length" class="text-[13px] text-slate-500">{{ $t('inbox.noDeals') }}</p>
      <div v-for="d in deals" :key="d.id" class="rounded-xl border border-slate-200 px-3 py-2.5">
        <p class="text-sm font-medium" dir="auto">{{ d.title }}</p>
        <p class="mt-0.5 flex justify-between text-xs text-slate-500">
          <span>{{ stageName(d.stageId) }}</span>
          <span class="num font-medium text-slate-900">{{ money(d.valueSar) }}</span>
        </p>
      </div>
    </section>

    <section class="flex flex-col gap-2.5 border-t border-slate-100 pt-5">
      <h2 class="kicker">{{ $t('tasks.title') }}</h2>
      <TaskList :contact-id="contact.id" compact />
    </section>

    <NuxtLink
      :to="`/contacts/${contact.id}`"
      class="mt-auto flex items-center gap-1.5 text-[13px] font-medium text-slate-900 underline-offset-4 hover:underline"
    >
      {{ $t('inbox.viewContact') }}
      <ArrowUpLeft class="size-4 ltr:-scale-x-100" :stroke-width="1.5" aria-hidden="true" />
    </NuxtLink>
  </aside>
</template>
