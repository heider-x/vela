import { ipcMain } from 'electron'
import { closeProjectDatabase } from '../database'

// 导入所有 Repository
import { ProjectCoreRepository, ProjectCoreData } from '../repositories/project-core-repository'
import { BlueprintRepository, BlueprintData } from '../repositories/blueprint-repository'
import { CharacterRepository, CharacterData, CharacterStateData } from '../repositories/character-repository'
import { DraftRepository } from '../repositories/draft-repository'
import { RevisionRepository } from '../repositories/revision-repository'
import { ReviewRepository } from '../repositories/review-repository'
import { PostProcessRepository } from '../repositories/post-process-repository'

// 沿用的旧表
import { LLMHistoryRepository } from '../repositories/llm-repository'
import { SummaryRepository } from '../repositories/summary-repository'
import { CanonRepository } from '../repositories/canon-repository'
import {
  safeValidate,
  validateCanonTimelineEventInput,
  validateCanonFactInput,
  validateCanonPlotLineInput,
  validateCanonCharacterStateSnapshot,
  validateCanonChapterSummary,
  validateCanonWritebackPayload,
} from '../ipc-validation'
import type {
  TimelineEvent,
  CharacterStateSnapshot,
  PlotLine,
  Fact,
  ChapterSummary,
} from '../../src/services/narrative-consistency/types'

export function registerDatabaseController() {
  ipcMain.handle('db:close', async () => {
    closeProjectDatabase()
    return { success: true }
  })

  // ============================================================
  // 1. project_core — 项目主台账
  // ============================================================
  ipcMain.handle('db:project-core-get', async () => {
    return ProjectCoreRepository.get()
  })

  ipcMain.handle('db:project-core-update', async (_event, data: Partial<ProjectCoreData>) => {
    try {
      ProjectCoreRepository.update(data)
      return { success: true }
    } catch (err) {
      console.error('[db:project-core-update] 失败:', err)
      return { success: false, error: String(err) }
    }
  })

  // ============================================================
  // 2. blueprints — 章节蓝图
  // ============================================================
  ipcMain.handle('db:blueprint-get-all', async () => {
    return BlueprintRepository.getAll()
  })

  ipcMain.handle('db:blueprint-get', async (_event, chapterNumber: number) => {
    return BlueprintRepository.getByChapter(chapterNumber)
  })

  ipcMain.handle('db:blueprint-upsert', async (_event, data: BlueprintData) => {
    try {
      BlueprintRepository.upsert(data)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:blueprint-upsert-many', async (_event, items: BlueprintData[]) => {
    try {
      BlueprintRepository.upsertMany(items)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:blueprint-update-notes', async (_event, chapterNumber: number, notes: string) => {
    try {
      BlueprintRepository.updateNotes(chapterNumber, notes)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // ============================================================
  // 3. characters — 角色卡
  // ============================================================
  ipcMain.handle('db:character-get-all', async () => {
    return CharacterRepository.getAll()
  })

  ipcMain.handle('db:character-upsert', async (_event, data: CharacterData) => {
    try {
      CharacterRepository.upsert(data)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:character-save-all', async (_event, items: CharacterData[]) => {
    try {
      CharacterRepository.saveAll(items)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:character-delete', async (_event, name: string) => {
    try {
      CharacterRepository.delete(name)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:character-update-state', async (_event, name: string, state: CharacterStateData) => {
    try {
      CharacterRepository.updateState(name, state)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // ============================================================
  // 4. drafts — 草稿
  // ============================================================
  ipcMain.handle('db:draft-create', async (_event, params: {
    chapterNumber: number
    version: number
    source: 'write' | 'rewrite'
    content: string
    wordCount: number
  }) => {
    try {
      const id = DraftRepository.create(params)
      return { success: true, id }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:draft-list', async (_event, chapterNumber: number) => {
    return DraftRepository.listByChapter(chapterNumber)
  })

  ipcMain.handle('db:draft-get-meta', async (_event, id: number) => {
    return DraftRepository.getMeta(id)
  })

  ipcMain.handle('db:draft-get-full', async (_event, id: number) => {
    return DraftRepository.getFull(id)
  })

  ipcMain.handle('db:draft-get-latest', async (_event, chapterNumber: number) => {
    return DraftRepository.getLatestByChapter(chapterNumber)
  })

  ipcMain.handle('db:draft-get-finalized', async (_event, chapterNumber: number) => {
    return DraftRepository.getFinalizedByChapter(chapterNumber)
  })

  ipcMain.handle('db:draft-get-max-finalized-chapter', async () => {
    return DraftRepository.getMaxFinalizedChapter()
  })
  ipcMain.handle('db:draft-next-version', async (_event, chapterNumber: number) => {
    return DraftRepository.getNextVersion(chapterNumber)
  })

  ipcMain.handle('db:draft-update-status', async (_event, id: number, status: string, wordCount?: number) => {
    try {
      DraftRepository.updateStatus(id, status, wordCount)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:draft-update-content', async (_event, id: number, content: string, wordCount: number) => {
    try {
      DraftRepository.updateContent(id, content, wordCount)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // ============================================================
  // 5. revisions — 修稿
  // ============================================================
ipcMain.handle('db:revision-create', async (_event, params: {
    baseDraftId: number
    revisionIndex: number
    revisionType: 'refine' | 'review-fix'
    userPrompt?: string
    reviewSourceId?: number
    content: string
    wordCount: number
  }) => {
    try {
      const id = RevisionRepository.create(params)
      return { success: true, id }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:revision-list', async (_event, baseDraftId: number) => {
    return RevisionRepository.listByDraft(baseDraftId)
  })

  ipcMain.handle('db:revision-get-pending', async (_event, baseDraftId: number) => {
    return RevisionRepository.getPending(baseDraftId)
  })

  ipcMain.handle('db:revision-get-full', async (_event, id: number) => {
    return RevisionRepository.getFull(id)
  })

  ipcMain.handle('db:revision-next-index', async (_event, baseDraftId: number) => {
    return RevisionRepository.getNextIndex(baseDraftId)
  })

  ipcMain.handle('db:revision-mark-merged', async (_event, id: number, mergedToDraftId: number) => {
    try {
      RevisionRepository.markMerged(id, mergedToDraftId)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:revision-mark-discarded', async (_event, id: number) => {
    try {
      RevisionRepository.markDiscarded(id)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // ============================================================
  // 6. reviews — 审稿
  // ============================================================
  ipcMain.handle('db:review-create', async (_event, params: {
    baseDraftId: number
    reviewIndex: number
    content: string
  }) => {
    try {
      const id = ReviewRepository.create(params)
      return { success: true, id }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:review-list', async (_event, baseDraftId: number) => {
    return ReviewRepository.listByDraft(baseDraftId)
  })

  ipcMain.handle('db:review-get-latest', async (_event, baseDraftId: number) => {
    return ReviewRepository.getLatestByDraft(baseDraftId)
  })

  ipcMain.handle('db:review-get-full', async (_event, id: number) => {
    return ReviewRepository.getFull(id)
  })

  ipcMain.handle('db:review-next-index', async (_event, baseDraftId: number) => {
    return ReviewRepository.getNextIndex(baseDraftId)
  })

  // ============================================================
  // 7. post_process — 后处理跑批
  // ============================================================
  ipcMain.handle('db:post-process-create-run', async (_event, params: {
    triggerSourceType: string
    triggerSourceId: string
    sourceLabel: string
    steps: Array<{ key: string; label: string; critical: boolean }>
  }) => {
    try {
      const id = PostProcessRepository.createRun(params)
      return { success: true, id }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:post-process-get-latest-run', async (_event, sourceType: string, sourceId: string) => {
    return PostProcessRepository.getLatestRun(sourceType, sourceId)
  })

  ipcMain.handle('db:post-process-get-steps', async (_event, runId: string) => {
    return PostProcessRepository.getSteps(runId)
  })

  ipcMain.handle('db:post-process-mark-step-ok', async (_event, runId: string, stepKey: string) => {
    try {
      PostProcessRepository.markStepOk(runId, stepKey)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:post-process-mark-step-failed', async (_event, runId: string, stepKey: string, errorMsg: string) => {
    try {
      PostProcessRepository.markStepFailed(runId, stepKey, errorMsg)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  ipcMain.handle('db:post-process-is-all-passed', async (_event, sourceType: string, sourceId: string) => {
    return PostProcessRepository.isAllCriticalPassed(sourceType, sourceId)
  })

  // ============================================================
  // 沿用旧表
  // ============================================================
  ipcMain.handle('db:log-llm-call', async (_event, call) => {
    try {
      LLMHistoryRepository.logCall(call)
      return { success: true }
    } catch (error) {
      console.error('[db:log-llm-call] Error:', error)
      return { success: false }
    }
  })

  ipcMain.handle('db:get-llm-stats', async () => {
    return LLMHistoryRepository.getStats()
  })

  ipcMain.handle('db:get-llm-history', async (_event, limit?: number) => {
    return LLMHistoryRepository.getHistory(limit ?? 50)
  })

  ipcMain.handle('db:save-summary-snapshot', async (_event, chapterNumber: number, characterStates: string) => {
    SummaryRepository.saveSnapshot(chapterNumber, characterStates)
    return { success: true }
  })

  ipcMain.handle('db:get-latest-summary', async () => {
    return SummaryRepository.getLatestSnapshot()
  })

  // ============================================================
  // Canon Store —— 叙事一致性持久化
  // ============================================================

  // 时间线
  ipcMain.handle('db:canon-timeline-get', async (_event, maxChapter: number, includeFlashback?: boolean) => {
    return CanonRepository.getTimelineUpTo(maxChapter, includeFlashback !== false)
  })
  ipcMain.handle('db:canon-timeline-get-chapter', async (_event, chapterNumber: number) => {
    return CanonRepository.getTimelineByChapter(chapterNumber)
  })
  ipcMain.handle('db:canon-timeline-append', async (_event, event: Omit<TimelineEvent, 'id' | 'createdAt'>) => {
    const v = safeValidate(validateCanonTimelineEventInput, event)
    if (!v.ok) return { success: false, error: v.error }
    try {
      const id = CanonRepository.appendTimelineEvent(v.data)
      return { success: true, id }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
  ipcMain.handle('db:canon-timeline-clear-chapter', async (_event, chapterNumber: number) => {
    CanonRepository.clearChapterTimeline(chapterNumber)
    return { success: true }
  })

  // 角色状态
  ipcMain.handle('db:canon-character-state-get-all', async () => {
    return CanonRepository.getAllCharacterStates()
  })
  ipcMain.handle('db:canon-character-state-get', async (_event, character: string) => {
    return CanonRepository.getCharacterState(character)
  })
  ipcMain.handle('db:canon-character-state-upsert', async (_event, snapshot: CharacterStateSnapshot) => {
    const v = safeValidate(validateCanonCharacterStateSnapshot, snapshot)
    if (!v.ok) return { success: false, error: v.error }
    try {
      CanonRepository.upsertCharacterState(v.data)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // 剧情线
  ipcMain.handle('db:canon-plot-list', async (_event, status?: PlotLine['status']) => {
    return CanonRepository.getPlotLines(status ? { status } : undefined)
  })
  ipcMain.handle('db:canon-plot-add', async (_event, line: Omit<PlotLine, 'id'>) => {
    const v = safeValidate(validateCanonPlotLineInput, line)
    if (!v.ok) return { success: false, error: v.error }
    try {
      const id = CanonRepository.addPlotLine(v.data)
      return { success: true, id }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
  ipcMain.handle('db:canon-plot-advance', async (_event, id: number, currentState: string, lastAdvancedAt: number) => {
    CanonRepository.advancePlotLine(id, currentState, lastAdvancedAt)
    return { success: true }
  })
  ipcMain.handle('db:canon-plot-resolve', async (_event, id: number, chapterNumber: number) => {
    CanonRepository.resolvePlotLine(id, chapterNumber)
    return { success: true }
  })

  // 事实
  ipcMain.handle('db:canon-fact-list', async () => {
    return CanonRepository.getFacts()
  })
  ipcMain.handle('db:canon-fact-add', async (_event, fact: Omit<Fact, 'id'>) => {
    const v = safeValidate(validateCanonFactInput, fact)
    if (!v.ok) return { success: false, error: v.error }
    try {
      const id = CanonRepository.addFact(v.data)
      return { success: true, id }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
  ipcMain.handle('db:canon-fact-clear-chapter', async (_event, chapterNumber: number) => {
    CanonRepository.clearChapterFacts(chapterNumber)
    return { success: true }
  })

  // 章节摘要
  ipcMain.handle('db:canon-summary-get', async (_event, chapterNumber: number) => {
    return CanonRepository.getSummary(chapterNumber)
  })
  ipcMain.handle('db:canon-summary-list-recent', async (_event, limit?: number) => {
    return CanonRepository.getRecentSummaries(limit ?? 5)
  })
  ipcMain.handle('db:canon-summary-upsert', async (_event, summary: ChapterSummary) => {
    const v = safeValidate(validateCanonChapterSummary, summary)
    if (!v.ok) return { success: false, error: v.error }
    try {
      CanonRepository.upsertSummary(v.data)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // 原子写回（推荐路径：单次事务）
  ipcMain.handle('db:canon-writeback-atomic', async (_event, payload: {
    chapterNumber: number
    newEvents: Omit<TimelineEvent, 'id' | 'createdAt'>[]
    characterDeltas: Array<{ character: string; after: Partial<CharacterStateSnapshot>; chapterNumber: number }>
    plotLineChanges?: {
      added?: Omit<PlotLine, 'id'>[]
      advanced?: Array<{ id: number; currentState: string; lastAdvancedAt: number }>
      resolved?: number[]
    }
    newFacts: Omit<Fact, 'id'>[]
  }) => {
    const v = safeValidate(validateCanonWritebackPayload, payload)
    if (!v.ok) return { success: false, error: v.error }
    try {
      const result = CanonRepository.writebackAtomically(v.data)
      return { success: true, ...result }
    } catch (err) {
      console.error('[db:canon-writeback-atomic] failed:', err)
      return { success: false, error: String(err) }
    }
  })
}
