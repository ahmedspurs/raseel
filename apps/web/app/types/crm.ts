export interface TagInfo {
  id: string
  name: string
  color: string
  contactCount?: number
}

export interface CustomFieldDef {
  id: string
  key: string
  label: string
  type: 'TEXT' | 'NUMBER' | 'DATE' | 'SELECT'
  options: string[]
}

export interface ContactInfo {
  id: string
  waId: string
  name: string | null
  waName: string | null
  displayName: string | null
  email: string | null
  company: string | null
  city: string | null
  language: 'ar' | 'en' | null
  notes: string | null
  customFields: Record<string, string | number>
  tags: TagInfo[]
  optInMarketing: boolean
  optedInAt: string | null
  optedOutAt: string | null
  createdAt: string
}

export interface TemplateComponent {
  type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS'
  format?: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'LOCATION'
  text?: string
  buttons?: { type: string; text: string }[]
}

export interface TemplateInfo {
  id: string
  name: string
  language: string
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION'
  status: string
  rejectedReason: string | null
  components: TemplateComponent[]
  syncedAt: string | null
}
