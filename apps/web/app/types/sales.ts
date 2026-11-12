export interface StageInfo {
  id: string
  name: string
  position: number
  kind: 'OPEN' | 'WON' | 'LOST'
}

export interface PipelineInfo {
  id: string
  name: string
  stages: StageInfo[]
}

export interface DealInfo {
  id: string
  title: string
  pipelineId: string
  stageId: string
  stageKind: StageInfo['kind']
  valueSar: number
  expectedClose: string | null
  position: number
  closedAt: string | null
  owner: { id: string; name: string } | null
  contact: { id: string; name: string | null; waId: string }
  openTasks: number
  createdAt: string
}

export interface TaskInfo {
  id: string
  title: string
  dueAt: string | null
  done: boolean
  contact: { id: string; name: string | null; waName: string | null; waId: string } | null
  deal: { id: string; title: string } | null
  assignee: { id: string; name: string } | null
}

export interface BroadcastStats {
  total: number
  pending: number
  skipped: number
  failed: number
  sent: number
  delivered: number
  read: number
  replied: number
}

export interface BroadcastInfo {
  id: string
  name: string
  status: 'DRAFT' | 'SCHEDULED' | 'SENDING' | 'COMPLETED' | 'CANCELLED'
  scheduledAt: string | null
  startedAt: string | null
  completedAt: string | null
  segment: { id: string; name: string } | null
  template: { id: string; name: string; language: string } | null
  stats: BroadcastStats
  createdAt: string
}

export interface SegmentFilter {
  tagIds: string[]
  tagMatch: 'any' | 'all'
  fields: Record<string, string>
  language: 'ar' | 'en' | null
}

export interface SegmentInfo {
  id: string
  name: string
  filter: SegmentFilter
  audience: number
}
