import { BaseWorkflowCommand, CommandExecuteParams } from './base-command'
import { useProjectStore } from '../../../stores/project-store'
import { getPromptTemplate } from '../../prompt-templates'
import { ChapterPromptBuilder } from '../../prompts/prompt-builder'
import { ipc } from '../../ipc-client'

import type { ChapterInfo } from '../chapter-workflow'
import {
  buildCanonContext,
  renderCanonContext,
  runConsistencyGate,
} from '../../narrative-consistency'

export interface RefineDraftParams {
  draftPath: string
  draftContent: string
  chapterNumber: number
  chapterInfo: ChapterInfo
  mergedGuidance?: string
  userRefinePrompt?: string
  shortSummary?: string
}

export class RefineDraftCommand extends BaseWorkflowCommand<string> {
  constructor(private params: RefineDraftParams) {
    super()
  }

  async execute({ context, callbacks }: CommandExecuteParams): Promise<string> {
    const project = useProjectStore.getState().currentProject
    if (!project) throw new Error('未打开项目')

    const draft = this.params.draftContent
    if (!draft) throw new Error('无草稿内容')

    callbacks.log('正在进行大神级修稿...')

    const template = getPromptTemplate('refine_chapter')
    if (!template) throw new Error('未找到修稿模板')

    const mergedGuidance = this.params.mergedGuidance || project.novelConfig.globalGuidance || ''
    const userPromptBlock = this.params.userRefinePrompt?.trim()
      ? `★【用户额外修稿指导（绝对优先级）】★：\n${this.params.userRefinePrompt}`
      : ''

    const promptBuilder = new ChapterPromptBuilder(template)
      .withDraftContent(draft)
      .withChapterInfo(this.params.chapterInfo)
      .withGlobalGuidance(mergedGuidance)
      .withGlobalSummary(this.params.shortSummary || '')
      .withShortSummary(this.params.shortSummary || '')
      .withWordNumber(project.novelConfig.wordsPerChapter)
      .withUserRefinePrompt(userPromptBlock)

    // ==========================================
    // [Canon] 注入叙事一致性上下文（精修时绝不破坏既有事实）
    // ==========================================
    try {
      const [core, allCharacters] = await Promise.all([
        ipc.invoke('db:project-core-get').catch(() => null as null | { premise?: string; charactersArch?: string; worldbuilding?: string; synopsis?: string }),
        ipc.invoke('db:character-get-all').catch(() => [] as Array<{ name: string; role: string; currentState?: { location?: string; powerLevel?: string; physicalState?: string; mentalState?: string; keyItems?: string; recentEvents?: string; updatedAtChapter?: number } }>),
      ])
      const canon = await buildCanonContext({
        chapterNumber: this.params.chapterNumber,
        architecture: {
          premise: core?.premise || '',
          charactersArch: core?.charactersArch || '',
          worldbuilding: core?.worldbuilding || '',
          synopsis: core?.synopsis || '',
        },
        characters: (allCharacters || []).map(c => ({
          name: c.name,
          role: c.role,
          currentState: c.currentState,
        })),
        chapterGoal: typeof this.params.chapterInfo === 'object' ? JSON.stringify(this.params.chapterInfo) : String(this.params.chapterInfo),
        previousEnding: '',
        ragContext: '',
        writingStyle: project.novelConfig.writingStyle || '',
        globalGuidance: mergedGuidance,
      })
      promptBuilder.withCanonContext(renderCanonContext(canon))
      callbacks.log(`  🛡️ [Canon] 精修已注入一致性上下文（时间线 ${canon.timeline.length} / 角色 ${canon.characterStates.length}）`)
      // 暂存以便后处理
      ;(context.data as Record<string, unknown>).__canonForRefine = canon
    } catch (e) {
      callbacks.log(`  ⚠️ [Canon] 精修上下文构造失败：${String(e)}`)
    }

    const refined = await this.callLLMWithBuilder(promptBuilder, callbacks)
    const cleanRefined = this.stripThinkingTags(refined)

    // ==========================================
    // [Canon] 精修后一致性 Gate（isRewrite=true：禁止破坏既有事实）
    // ==========================================
    let finalRefined = cleanRefined
    const canonForRefine = (context.data as Record<string, unknown>).__canonForRefine as import('../../narrative-consistency').CanonContext | undefined
    if (canonForRefine) {
      try {
        const gateResult = await runConsistencyGate({
          chapterNumber: this.params.chapterNumber,
          chapterContent: cleanRefined,
          canon: canonForRefine,
          isRewrite: true,
        })
        callbacks.log(`  🛡️ [Gate] 精修 ${gateResult.verdict}: ${gateResult.report}`)
        if (gateResult.verdict === 'BLOCK') {
          throw new Error(`精修结果被叙事一致性 Gate 阻止：${gateResult.blockingReasons.join('；')}`)
        }
        if (gateResult.verdict === 'REPAIR' && gateResult.repairedContent) {
          finalRefined = gateResult.repairedContent
          callbacks.log(`  🛡️ [Canon] 精修自动修复 ${gateResult.repairAttempts} 轮后保存修复稿`)
        }
        if (gateResult.issues.length === 0) {
          callbacks.log(`  ✅ [Canon] 精修一致性检查通过`)
        }
        const remaining = gateResult.issues.map(i => i.issue)
        if (remaining.length > 0) context.data.consistencyWarnings = remaining
        context.data.consistencyReport = {
          verdict: gateResult.verdict,
          totalIssues: gateResult.issues.length,
          repairAttempts: gateResult.repairAttempts,
          remaining: gateResult.issues.length,
        }
      } catch (e) {
        callbacks.log(`  ❌ [Canon] 精修 Gate 异常：${String(e)}`)
        throw e
      }
    }

    const { parseDraftMeta } = await import('../chapter-workflow')
    const baseDraft = await parseDraftMeta(this.params.draftPath)
    if (!baseDraft) throw new Error('找不到基准草稿版本')

    const revIndex = await ipc.invoke('db:revision-next-index', baseDraft.id)

    // 清理该草稿下已有的 pending 状态修稿，保证只保留最新的一条
    const pendingRevs = await ipc.invoke('db:revision-get-pending', baseDraft.id)
    for (const rev of pendingRevs) {
      await ipc.invoke('db:revision-mark-discarded', rev.id)
    }

    const createRes = await ipc.invoke('db:revision-create', {
      baseDraftId: baseDraft.id,
      revisionIndex: revIndex,
      revisionType: 'refine',
      content: finalRefined,
      wordCount: finalRefined.length,
    }) as { success: boolean; id: number }

    const { useEditorStore } = await import('../../../stores/editor-store')
    useEditorStore.getState().openFile({
      id: `diff-${this.params.draftPath}-${createRes.id}`,
      name: `修稿合并：第${this.params.chapterNumber}章`,
      type: 'diff',
      filePath: this.params.draftPath,
      originalContent: this.params.draftContent,
      content: finalRefined,
      revisionPath: String(createRes.id),
      chapterNumber: this.params.chapterNumber,
      chapterDir: `vela://draft/ch${this.params.chapterNumber}`,
    })

    context.data.refined = finalRefined
    context.data.refinedPath = this.params.draftPath
    callbacks.log(`✅ 修稿完成（${finalRefined.length} 字），已生成修订稿版本 r${revIndex}`)
    return finalRefined
  }
}
