import type { WorkflowDefinition } from '../../stores/workflow-store'
import { useProjectStore } from '../../stores/project-store'
import { ipc } from '../ipc-client'
import type { BlueprintData } from '../../../electron/repositories/blueprint-repository'
import { stripThinkingTags } from './workflow-utils'
import i18n from '../../i18n'

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, { ns: 'commands', ...opts })

// ==========================================
// 1. 结构与类型导出 (保留对外的向后兼容)
// ==========================================

export type ChapterBlueprint = BlueprintData

const EMPTY_BLUEPRINT: ChapterBlueprint = {
  chapterNumber: 0,
  title: '',
  role: '',
  purpose: '',
  keyEvents: '',
  characters: [],
  suspenseHook: '',
  userGuidance: '',
  notes: '',
  notesUpdatedAt: '',
}

export interface DirectoryWorkflowParams {
  mode: 'full' | 'append'
  startChapter?: number
  count?: number
  /** 节奏/风格指导（可选） */
  pacingGuidance?: string
}

// ==========================================
// 2. 蓝图文件访问与工具函数
// ==========================================

export function parseTextBlueprints(content: string, startNum: number, endNum: number): ChapterBlueprint[] {
  const clean = stripThinkingTags(content).replace(/```(?:json)?\s*/gi, '').trim()
  let parsed: unknown
  // Some gateways put untagged reasoning or example JSON before the final answer.
  // Read balanced candidates from the end, respecting braces inside JSON strings.
  for (let start = clean.length - 1; start >= 0; start--) {
    if (clean[start] !== '[' && clean[start] !== '{') continue
    let depth = 0, quoted = false, escaped = false
    for (let end = start; end < clean.length; end++) {
      const char = clean[end]
      if (quoted) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === '"') quoted = false
        continue
      }
      if (char === '"') quoted = true
      else if (char === '[' || char === '{') depth++
      else if (char === ']' || char === '}') depth--
      if (depth !== 0) continue
      try {
        const candidate = JSON.parse(clean.slice(start, end + 1))
        const list = Array.isArray(candidate) ? candidate : candidate?.blueprints
        if (Array.isArray(list) && (list.length > 0 || !Array.isArray(candidate) || !clean.slice(end + 1).trim()) &&
            list.every(p => p && typeof p === 'object' && ('chapterNumber' in p || 'chapter_number' in p))) parsed = list
      } catch { /* Continue looking for the final complete blueprint payload. */ }
      break
    }
    if (parsed) break
  }
  if (!Array.isArray(parsed)) return []
  const distinct = new Map<number, ChapterBlueprint>()
  for (const value of parsed) {
    if (!value || typeof value !== 'object') continue
    const p = value as Record<string, unknown>
    const chapterNumber = Number(p.chapterNumber ?? p.chapter_number)
    const keyEvents = p.keyEvents ?? p.key_events
    if (!Number.isSafeInteger(chapterNumber) || chapterNumber < startNum || chapterNumber > endNum ||
        typeof p.title !== 'string' || !p.title.trim() || typeof keyEvents !== 'string' || !keyEvents.trim()) continue
    if (!distinct.has(chapterNumber)) distinct.set(chapterNumber, {
      ...EMPTY_BLUEPRINT, chapterNumber, title: p.title.trim(), role: String(p.role || t('workflowDefs.dirDefaultRole')),
      purpose: String(p.purpose || ''), keyEvents,
      characters: Array.isArray(p.characters) ? p.characters.filter((c): c is string => typeof c === 'string') : [],
      suspenseHook: String(p.suspenseHook || p.suspense_hook || ''),
    })
  }
  return [...distinct.values()].sort((a, b) => a.chapterNumber - b.chapterNumber)
}

export async function loadDirectoryBlueprints(): Promise<ChapterBlueprint[]> {
  try {
    const blueprints = await ipc.invoke('db:blueprint-get-all')
    return blueprints.sort((a, b) => a.chapterNumber - b.chapterNumber)
  } catch {
    return []
  }
}

export async function saveChapterBlueprint(blueprint: ChapterBlueprint, projectPath?: string): Promise<void> {
  const result = await ipc.invoke('db:blueprint-upsert', blueprint, projectPath)
  if (!result.success) throw new Error(result.error || 'BLUEPRINT_SAVE_FAILED')
}

export async function saveAllBlueprints(blueprints: ChapterBlueprint[], projectPath?: string): Promise<void> {
  const result = await ipc.invoke('db:blueprint-upsert-many', blueprints, projectPath)
  if (!result.success) throw new Error(result.error || 'BLUEPRINT_SAVE_FAILED')
}

export async function getBlueprintCount(): Promise<number> {
  try {
    const blueprints = await ipc.invoke('db:blueprint-get-all')
    return blueprints.length
  } catch {
    return 0
  }
}

// ==========================================
// 3. 工作流定义映射工厂 (Command 调度层)
// ==========================================

export function createDirectoryWorkflow(params: DirectoryWorkflowParams = { mode: 'full' }): WorkflowDefinition {
  return {
    type: 'directory',
    title: params.mode === 'append' ? t('workflowDefs.dirAppendTitle', { chapter: params.startChapter || '' })
      : params.count ? t('workflowDefs.dirRangeTitle', { from: 1, to: Math.min(params.count, useProjectStore.getState().currentProject?.novelConfig.totalChapters ?? params.count) })
      : t('workflowDefs.dirFullTitle'),
    steps: [
      {
        name: t('workflowDefs.dirStepReadArch'),
        description: t('workflowDefs.dirStepReadArchDesc'),
        executor: async (_step, context, callbacks) => {
          const project = useProjectStore.getState().currentProject
          if (!project) throw new Error(t('common.noProject'))
          context.data.directoryProjectPath = project.path

          callbacks.log(t('workflowDefs.dirReadingArch'))
          const core = await ipc.invoke('db:project-core-get')
          if (!core) throw new Error(t('workflowDefs.dirCoreDataNotInit'))

          const parts: string[] = []
          if (core.premise && core.premise.length > 50) parts.push(core.premise)
          if (core.charactersArch && core.charactersArch.length > 50) parts.push(core.charactersArch)
          if (core.worldbuilding && core.worldbuilding.length > 50) parts.push(core.worldbuilding)
          if (core.synopsis && core.synopsis.length > 50) parts.push(core.synopsis)

          if (parts.length === 0) throw new Error(t('workflowDefs.dirArchNotGenerated'))

          context.data.architecture = parts.join('\n\n---\n\n')
          // 注入节奏指导到 context，供 Command 读取
          if (params.pacingGuidance) context.data.pacingGuidance = params.pacingGuidance
          if (params.mode === 'append') {
            const existing = await loadDirectoryBlueprints()
            context.data.existingBlueprints = existing
            callbacks.log(t('workflowDefs.dirLoadedBlueprints', { count: existing.length }))
          }
          return t('workflowDefs.dirArchLoaded', { count: parts.length })
        },
      },
      {
        name: t('workflowDefs.dirStepGenerate'),
        description: t('workflowDefs.dirStepGenerateDesc'),
        executor: async (_step, context, callbacks) => {
          const { GenerateDirectoryCommand } = await import('./commands/directory.command')
          const cmd = new GenerateDirectoryCommand(params)
          const blueprints = await cmd.execute({ step: _step, context, callbacks })
          // 返回可读摘要字符串（step.result 必须是 string，否则 AIOutputPanel 渲染会崩溃）
          return t('workflowDefs.dirGeneratedBlueprints', { count: blueprints.length })
        },
      },
      {
        name: t('workflowDefs.dirStepSave'),
        description: t('workflowDefs.dirStepSaveDesc'),
        executor: async (_step, context, callbacks) => {
          const project = useProjectStore.getState().currentProject
          if (!project) throw new Error(t('common.noProject'))

          const newBlueprints = context.data.newBlueprints as ChapterBlueprint[]
          if (!newBlueprints?.length) throw new Error(i18n.t('directory.noSavedBlueprints', { ns: 'commands' }))
          if (context.data.directoryProjectPath !== project.path) throw new Error('PROJECT_CHANGED')
          callbacks.log(t('workflowDefs.dirSavingBlueprints'))
          // Each batch is already durable. Verify instead of overwriting edits a second time.
          const saved = await ipc.invoke('db:blueprint-get-all', project.path)
          if (newBlueprints.some(bp => !saved.some(row => row.chapterNumber === bp.chapterNumber))) {
            throw new Error(i18n.t('directory.noSavedBlueprints', { ns: 'commands' }))
          }
          void useProjectStore.getState().refreshFileTree()
          return i18n.t('directory.verifiedSaved', { ns: 'commands', count: newBlueprints.length })
        },
      },
    ],
    onComplete: {
      mode: 'silent',
      message: params.mode === 'append' ? t('workflowDefs.dirCompletedAppend') : t('workflowDefs.dirCompletedFull'),
    },
  }
}
