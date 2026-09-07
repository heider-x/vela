import type { RehearsalInput } from '../services/story-rehearsal'
import type { RehearsalDirection } from './story-rehearsal'

export interface RehearsalScene { text: string; director: string }
export interface RehearsalResult {
  input: RehearsalInput | null
  directions: RehearsalDirection[]
  selected: number
  scenes: Record<number, RehearsalScene>
  previousScenes: Record<number, RehearsalScene>
}
export interface RehearsalSession extends RehearsalResult {
  intent: string
  constraints: string
  director: string
  previousResult: RehearsalResult | null
}

// Owned by the blueprint editor, isolated by project and chapter. Never stores API keys.
export const emptyRehearsalSession = (): RehearsalSession => ({
  intent: '', constraints: '', director: '', input: null, directions: [], selected: 0,
  scenes: {}, previousScenes: {}, previousResult: null,
})
