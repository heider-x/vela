/** Trial plans are author proposals; they never write manuscript or canon state. */
export interface RehearsalExcerpt {
  chapterNumber: number
  draftId: number
  version: number
  text: string
  truncated: boolean
}

export interface RehearsalContext {
  projectPath: string
  targetChapter: number
  authorPlan: Record<string, string>
  planTruncated: boolean
  previousExcerpts: RehearsalExcerpt[]
}

export interface RehearsalDirection {
  title: string
  premise: string
  motive: string
  opposition: string
  cost: string
  aftermath: string
  setup: string
  risk: string
  events: string
}

export const DIRECTION_FIELDS = [
  'premise', 'motive', 'opposition', 'cost', 'aftermath', 'setup', 'risk', 'events',
] as const

export type RehearsalMessages = Array<{ role: 'system' | 'user'; content: string }>
