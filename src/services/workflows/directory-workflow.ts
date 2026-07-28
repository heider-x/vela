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
  let result: ChapterBlueprint[] = []

  try {
    const cleanContent = stripThinkingTags(content)
    const jsonStr = cleanContent.replace(/```json?\n?/g, '').replace(/```\n?/g, '').trim()
    const startIndex = jsonStr.indexOf('{')
    const endIndex = jsonStr.lastIndexOf('}')

    if (startIndex !== -1 && endIndex !== -1) {
      const arrayStr = jsonStr.substring(startIndex, endIndex + 1)
      let parsed = JSON.parse(arrayStr)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.blueprints) {
        parsed = parsed.blueprints
      }
      if (Array.isArray(parsed)) {
        result = parsed
          .filter((p: Record<string, unknown>) => {
            const n = Number(p.chapterNumber || p.chapter_number)
            return n >= startNum && n <= endNum
          })
          .map((p: Record<string, unknown>) => ({
            ...EMPTY_BLUEPRINT,
            chapterNumber: Number(p.chapterNumber || p.chapter_number || 0),
            title: String(p.title || t('workflowDefs.chapterTitleFallback', { chapter: p.chapterNumber })),
            role: String(p.role || t('workflowDefs.dirDefaultRole')),
            purpose: String(p.purpose || ''),
            keyEvents: String(p.keyEvents || p.key_events || ''),
            characters: Array.isArray(p.characters) ? p.characters : [],
            suspenseHook: String(p.suspenseHook || p.suspense_hook || ''),
            userGuidance: '',
          }))
      }
    }
  } catch {
    console.error('Failed to parse blueprint JSON', content)
  }

  const distinctMap = new Map<number, ChapterBlueprint>()
  for (const item of result) {
    if (!distinctMap.has(item.chapterNumber)) distinctMap.set(item.chapterNumber, item)
  }

  return Array.from(distinctMap.values()).sort((a, b) => a.chapterNumber - b.chapterNumber)
}

export async function loadDirectoryBlueprints(): Promise<ChapterBlueprint[]> {
  try {
    const blueprints = await ipc.invoke('db:blueprint-get-all')
    return blueprints.sort((a, b) => a.chapterNumber - b.chapterNumber)
  } catch {
    return []
  }
}

export async function saveChapterBlueprint(blueprint: ChapterBlueprint): Promise<void> {
  await ipc.invoke('db:blueprint-upsert', blueprint)
}

export async function saveAllBlueprints(blueprints: ChapterBlueprint[]): Promise<void> {
  await ipc.invoke('db:blueprint-upsert-many', blueprints)
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
    title: params.mode === 'append' ? t('workflowDefs.dirAppendTitle', { chapter: params.startChapter || '' }) : t('workflowDefs.dirFullTitle'),
    steps: [
      {
        name: t('workflowDefs.dirStepReadArch'),
        description: t('workflowDefs.dirStepReadArchDesc'),
        executor: async (_step, context, callbacks) => {
          const project = useProjectStore.getState().currentProject
          if (!project) throw new Error(t('common.noProject'))

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
          const existingBlueprints = context.data.existingBlueprints as ChapterBlueprint[]

          callbacks.log(t('workflowDefs.dirSavingBlueprints'))

          let merged: ChapterBlueprint[]
          if (params.mode === 'full') {
            merged = newBlueprints
            // TODO: 若需要清理冗余蓝图，可考虑添加 db:blueprint-delete-all 以严格符合全量替换的意图。
            // 在当前 upsert-many 中，仅覆盖更新
          } else {
            const existingMap = new Map(existingBlueprints.map(b => [b.chapterNumber, b]))
            for (const nb of newBlueprints) existingMap.set(nb.chapterNumber, nb)
            merged = Array.from(existingMap.values()).sort((a, b) => a.chapterNumber - b.chapterNumber)
          }

          await saveAllBlueprints(merged)
          useProjectStore.getState().refreshFileTree()
          return t('workflowDefs.dirBlueprintsSaved')
        },
      },
    ],
    onComplete: {
      mode: 'silent',
      message: params.mode === 'append' ? t('workflowDefs.dirCompletedAppend') : t('workflowDefs.dirCompletedFull'),
    },
  }
}
