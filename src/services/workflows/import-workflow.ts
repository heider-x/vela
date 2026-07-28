/**
 * 导入小说工作流定义
 *
 * 逆向推演全流程：
 * 步骤1: 写入正文 + 构建知识库
 * 步骤2: 向量采样 + AI 推演全局配置/架构/角色
 * 步骤3: AI 按章推演精准蓝图 + 蓝图入向量库 + 拼装轻量全局摘要
 * 步骤4: 完成后处理（刷新 UI 状态）
 */

import type { WorkflowDefinition } from '../../stores/workflow-store'
import type { ImportedChapter } from './commands/import-novel.command'
import i18n from '../../i18n'

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, { ns: 'commands', ...opts })

export interface ImportWorkflowParams {
  /** 拆分后的章节数据 */
  chapters: ImportedChapter[]
}

/**
 * 创建导入小说工作流
 */
export function createImportWorkflow(params: ImportWorkflowParams): WorkflowDefinition {
  return {
    type: 'novel_import',
    title: t('workflowDefs.importTitle', { count: params.chapters.length }),
    steps: [
      // ===== 步骤 1: 写入正文 + 构建知识库 =====
      {
        name: t('workflowDefs.importStepWriteKB'),
        description: t('workflowDefs.importStepWriteKBDesc', { count: params.chapters.length }),
        executor: async (step, context, callbacks) => {
          const { ImportInitializeCommand } = await import('./commands/import-novel.command')
          const cmd = new ImportInitializeCommand(params.chapters)
          return cmd.execute({ step, context, callbacks })
        },
      },

      // ===== 步骤 2: 向量采样 + AI 推演全局设定 =====
      {
        name: t('workflowDefs.importStepInferGlobal'),
        description: t('workflowDefs.importStepInferGlobalDesc'),
        executor: async (step, context, callbacks) => {
          const { InferGlobalSettingsCommand } = await import('./commands/import-novel.command')
          const cmd = new InferGlobalSettingsCommand()
          return cmd.execute({ step, context, callbacks })
        },
      },

      // ===== 步骤 3: AI 按章推演蓝图 + 蓝图入向量库 + 拼装摘要 =====
      {
        name: t('workflowDefs.importStepInferBlueprints'),
        description: t('workflowDefs.importStepInferBlueprintsDesc', { count: params.chapters.length }),
        executor: async (step, context, callbacks) => {
          const { InferBlueprintsPerChapterCommand } = await import('./commands/import-novel.command')
          const cmd = new InferBlueprintsPerChapterCommand()
          return cmd.execute({ step, context, callbacks })
        },
      },

      // ===== 步骤 4: 完成后处理 =====
      {
        name: t('workflowDefs.importStepPostProcess'),
        description: t('workflowDefs.importStepPostProcessDesc'),
        executor: async (_step, _context, callbacks) => {
          callbacks.log(t('workflowDefs.importRefreshingData'))
          callbacks.setProgress(30)

          // 刷新文件树
          const { useProjectStore } = await import('../../stores/project-store')
          await useProjectStore.getState().refreshFileTree()

          // 加载角色卡
          try {
            const { useCharacterStore } = await import('../../stores/character-store')
            const project = useProjectStore.getState().currentProject
            if (project) {
              await useCharacterStore.getState().loadCharacters(project.path)
            }
          } catch { /* 忽略 */ }

          // 加载草稿索引
          try {
            const { useDraftStore } = await import('../../stores/draft-store')
            await useDraftStore.getState().loadAllDrafts()
          } catch { /* 忽略 */ }

          callbacks.log(t('workflowDefs.importCompleteLog'))
          callbacks.setProgress(100)
        },
      },
    ],
    onComplete: {
      mode: 'silent',
      message: t('workflowDefs.importCompletedMessage'),
    },
  }
}

/**
 * 预估导入的 Token 消耗
 * @param totalWords 总字数
 * @param chapterCount 章节数
 * @returns 预估信息
 */
export function estimateImportCost(_totalWords: number, chapterCount: number): {
  estimatedTokens: number
  estimatedMinutes: number
  breakdown: string
} {
  // 粗略预估（偏保守）：
  // 1. 全局推演：首章+末章(约6000字) × 2(输入+输出) ≈ 12000 tokens
  // 2. 按章蓝图：每章正文(平址3000字) + 蓝图输出(约500字) ≈ 3500 tokens/章
  // 3. 全局摘要：从蓝图拼装，零 LLM 调用
  // 4. 知识库向量化不计入 LLM Token

  const globalInferTokens = 15000
  const blueprintTokensPerChapter = 4000
  const totalBlueprintTokens = blueprintTokensPerChapter * chapterCount

  const estimatedTokens = globalInferTokens + totalBlueprintTokens

  // 预估时间（假设每次 LLM 调用约 8-15 秒，并发 3）
  const llmCallCount = 1 + Math.ceil(chapterCount / 3) // 全局推演 + 蓝图批次
  const estimatedMinutes = Math.ceil(llmCallCount * 12 / 60) // 按每次 12 秒计算

  const breakdown = [
    t('workflowDefs.estimateCostGlobalInfer', { tokens: (globalInferTokens / 1000).toFixed(0) }),
    t('workflowDefs.estimateCostBlueprint', { tokens: (totalBlueprintTokens / 1000).toFixed(0), chapters: chapterCount, perChapter: (blueprintTokensPerChapter / 1000).toFixed(1) }),
    t('workflowDefs.estimateCostSummary'),
    t('workflowDefs.estimateCostTotal', { tokens: (estimatedTokens / 1000).toFixed(0) }),
  ].join('\n')

  return { estimatedTokens, estimatedMinutes, breakdown }
}
