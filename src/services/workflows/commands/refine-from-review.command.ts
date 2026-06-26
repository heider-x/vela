import { BaseWorkflowCommand, CommandExecuteParams } from './base-command'
import { useProjectStore } from '../../../stores/project-store'
import { getPromptTemplate } from '../../prompt-templates'
import { ChapterPromptBuilder } from '../../prompts/prompt-builder'
import { ipc } from '../../ipc-client'

import {
  buildCanonContext,
  renderCanonContext,
  runConsistencyGate,
} from '../../narrative-consistency'


export interface RefineFromReviewParams {
  draftPath: string
  draftContent: string
  reviewReport: string
  reviewFileName?: string
  chapterNumber: number
  userRefinePrompt?: string
}

export class RefineFromReviewCommand extends BaseWorkflowCommand<string> {
  constructor(private params: RefineFromReviewParams) {
    super()
  }

  async execute({ callbacks, context }: CommandExecuteParams): Promise<string> {
    const project = useProjectStore.getState().currentProject
    if (!project) throw new Error('未打开项目')

    callbacks.log('正在根据审稿报告精准修复...')

    const template = getPromptTemplate('refine_from_review')
    if (!template) throw new Error('未找到审稿修复模板')

    const userPromptBlock = this.params.userRefinePrompt?.trim()
      ? `★【用户额外修稿指导（绝对优先级）】★：\n${this.params.userRefinePrompt}`
      : ''

    const promptBuilder = new ChapterPromptBuilder(template)
      .withReviewReport(this.params.reviewReport)
      .withDraftContent(this.params.draftContent)
      .withGlobalGuidance(project.novelConfig.globalGuidance || '')
      .withUserRefinePrompt(userPromptBlock)

    // ==========================================
    // [Canon] 注入叙事一致性上下文（审稿修复时绝不破坏既有事实）
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
        chapterGoal: `第${this.params.chapterNumber}章审稿修复`,
        previousEnding: '',
        ragContext: '',
        writingStyle: project.novelConfig.writingStyle || '',
        globalGuidance: project.novelConfig.globalGuidance || '',
      })
      promptBuilder.withCanonContext(renderCanonContext(canon))
      callbacks.log(`  🛡️ [Canon] 审稿修复已注入一致性上下文（时间线 ${canon.timeline.length} / 角色 ${canon.characterStates.length}）`)
      ;(context.data as Record<string, unknown>).__canonForReviewRefine = canon
    } catch (e) {
      callbacks.log(`  ⚠️ [Canon] 审稿修复上下文构造失败：${String(e)}`)
    }

    const refined = await this.callLLMWithBuilder(promptBuilder, callbacks)
    const cleanRefined = this.stripThinkingTags(refined)

    // ==========================================
    // [Canon] 审稿修复后一致性 Gate（isRewrite=true）
    // ==========================================
    let finalRefined = cleanRefined
    const canonForReviewRefine = (context.data as Record<string, unknown>).__canonForReviewRefine as import('../../narrative-consistency').CanonContext | undefined
    if (canonForReviewRefine) {
      try {
        const gateResult = await runConsistencyGate({
          chapterNumber: this.params.chapterNumber,
          chapterContent: cleanRefined,
          canon: canonForReviewRefine,
          isRewrite: true,
        })
        callbacks.log(`  🛡️ [Gate] 审稿修复 ${gateResult.verdict}: ${gateResult.report}`)
        if (gateResult.verdict === 'BLOCK') {
          throw new Error(`审稿修复结果被叙事一致性 Gate 阻止：${gateResult.blockingReasons.join('；')}`)
        }
        if (gateResult.verdict === 'REPAIR' && gateResult.repairedContent) {
          finalRefined = gateResult.repairedContent
          callbacks.log(`  🛡️ [Canon] 审稿修复自动修复 ${gateResult.repairAttempts} 轮后保存修复稿`)
        }
        if (gateResult.issues.length === 0) {
          callbacks.log(`  ✅ [Canon] 审稿修复一致性检查通过`)
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
        callbacks.log(`  ❌ [Canon] 审稿修复 Gate 异常：${String(e)}`)
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
      revisionType: 'review-fix',
      content: finalRefined,
      wordCount: finalRefined.length,
      userPrompt: this.params.userRefinePrompt,
    }) as { success: boolean; id: number }

    const { useEditorStore } = await import('../../../stores/editor-store')
    useEditorStore.getState().openFile({
      id: `diff-${this.params.draftPath}-${createRes.id}`,
      name: `审稿修复：第${this.params.chapterNumber}章`,
      type: 'diff',
      filePath: this.params.draftPath,
      originalContent: this.params.draftContent,
      content: finalRefined,
      revisionPath: String(createRes.id),
      chapterNumber: this.params.chapterNumber,
      chapterDir: `vela://draft/ch${this.params.chapterNumber}`,
    })

    callbacks.log(`✅ 审稿修复完成（${finalRefined.length} 字），已生成修订稿版本 r${revIndex}`)
    return finalRefined
  }
}
