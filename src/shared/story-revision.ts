export type StoryDocumentKind = 'core' | 'blueprint' | 'character' | 'draft'
export interface StoryDocumentRef { kind: StoryDocumentKind; id: string }
export interface StoryDocument extends StoryDocumentRef {
  title: string
  version: string
  fields: Record<string, string>
  chapterNumber?: number
  status?: string
}
export interface StoryReadRequest extends StoryDocumentRef { field?: string; offset?: number }
export interface StoryReadResult extends Omit<StoryDocument, 'fields'> {
  fieldLengths: Record<string, number>
  field?: string
  content?: string
  nextOffset?: number | null
}
export interface StoryTextEdit extends StoryDocumentRef {
  version: string
  field: string
  oldText: string
  newText: string
}
export interface StoryRevisionRequest {
  intent: string
  summary: string
  edits: StoryTextEdit[]
  /** Only set when the author explicitly requests changes to already written text. */
  editWrittenText?: boolean
}
export interface StoryRevisionChange extends StoryDocumentRef {
  title: string
  field: string
  before: string
  after: string
  draftState?: { beforeStatus: string; beforeWordCount: number; afterStatus: string }
}
export interface StoryRevision {
  id: string
  intent: string
  summary: string
  createdAt: string
  status: 'applied' | 'undone'
  changes: StoryRevisionChange[]
}
export interface StoryIndexEntry extends StoryDocumentRef {
  title: string
  chapterNumber?: number
  status?: string
  excerpt: string
}
export interface StoryIndex { entries: StoryIndexEntry[]; total: number; nextOffset: number | null }
