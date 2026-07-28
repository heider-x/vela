import { BaseWorkflowCommand, CommandExecuteParams } from './base-command'
import { useProjectStore } from '../../../stores/project-store'
import { getPromptTemplate } from '../../prompt-templates'
import { ReviewPromptBuilder } from '../../prompts/prompt-builder'
import { ipc } from '../../ipc-client'
import { buildCanonContext, renderCanonContext } from '../../narrative-consistency'
import i18n from '../../../i18n'

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, { ns: 'commands', ...opts })


export interface ReviewChapterParams {
  draftPath: string
  draftContent: string
  chapterNumber: number
  /** 审稿维度侧重点（可选） */
  reviewFocus?: string
}

export class ReviewChapterCommand extends BaseWorkflowCommand<string> {
  constructor(private params: ReviewChapterParams) {
    super()
  }

  async execute({ callbacks }: CommandExecuteParams): Promise<string> {
    const project = useProjectStore.getState().currentProject
    if (!project) throw new Error(t('common.noProject'))

    const draft = this.params.draftContent
    if (!draft) throw new Error(t('common.noDraftContent'))

    callbacks.log(t('reviewChapter.preparingReview'))
    callbacks.log(t('reviewChapter.searchingArchives'))

    // 使用向量检索获取与待审章节相关的历史上下文（替代全局摘要）
    let contextSummary = t('reviewChapter.noContextReference')
    try {
      // 从待审内容中提取前 200 字作为检索 query
      const queryText = draft.slice(0, 200)
      const results = await ipc.invoke('kb:search', queryText, 5)
      if (results.length > 0) {
        contextSummary = results
          .map((r: { fileName: string; score: number; text: string }, i: number) =>
            t('generateDraft.kbResultLine', { index: i + 1, file: r.fileName, score: (r.score * 100).toFixed(0), text: r.text }))
          .join('\n\n')
      }
    } catch {
      contextSummary = t('reviewChapter.kbUnavailable')
    }

    const characterState = await this.readCharacterStates()
    const worldBuilding = await this.readWorldBuilding()

    const template = getPromptTemplate('consistency_check')
    if (!template) throw new Error(t('reviewChapter.templateNotFound'))

        // ==========================================
    // [Canon] 注入叙事一致性上下文 — 审稿员交叉验证事实基线
    // ==========================================
    let promptBuilder: ReviewPromptBuilder;
    try {
      const [core, allCharacters] = await Promise.all([
        ipc.invoke("db:project-core-get").catch(() => null as null | { premise?: string; charactersArch?: string; worldbuilding?: string; synopsis?: string }),
        ipc.invoke("db:character-get-all").catch(() => [] as Array<Record<string, unknown>>),
      ]);
      const canon = await buildCanonContext({
        chapterNumber: this.params.chapterNumber,
        architecture: {
          premise: core?.premise || "",
          charactersArch: core?.charactersArch || "",
          worldbuilding: core?.worldbuilding || "",
          synopsis: core?.synopsis || "",
        },
        characters: (allCharacters || []).map(c => ({
          name: c.name as string,
          role: c.role as string,
          currentState: c.currentState as { location?: string; powerLevel?: string; physicalState?: string; mentalState?: string; keyItems?: string; recentEvents?: string; updatedAtChapter?: number } | undefined,
        })),
        chapterGoal: `第${this.params.chapterNumber}章审稿`,
        previousEnding: "",
        ragContext: "",
        writingStyle: project.novelConfig.writingStyle || "",
        globalGuidance: project.novelConfig.globalGuidance || "",
      });
      promptBuilder = new ReviewPromptBuilder(template);
      promptBuilder.withCanonContext(renderCanonContext(canon));
      callbacks.log(t('canon.reviewContextInjected', { timeline: canon.timeline.length, characters: canon.characterStates.length }));
    } catch (e) {
      promptBuilder = new ReviewPromptBuilder(template);
      callbacks.log(t('canon.reviewContextFailed', { error: String(e) }));
    }

    promptBuilder
      .withChapterContent(draft)
      .withCharacterStates(characterState)
      .withGlobalSummary(contextSummary)
      .withWorldBuilding(worldBuilding)
      .withReviewFocus(this.params.reviewFocus || '');

    callbacks.log(t('reviewChapter.callingReviewer'))

    // 期望 JSON 格式返回
    const reviewResultRaw = await this.callLLMWithBuilder(
      promptBuilder,
      callbacks,
      { responseFormat: { type: 'json_object' } }
    )

    const reviewResultClean = this.stripThinkingTags(reviewResultRaw)

    const { parseDraftMeta } = await import('../chapter-workflow')
    const baseDraft = await parseDraftMeta(this.params.draftPath)
    if (!baseDraft) throw new Error(t('common.baseDraftNotFound'))
    const baseVersion = baseDraft.version

    const revIndex = await ipc.invoke('db:review-next-index', baseDraft.id)

    let parsedResult
    try {
      parsedResult = this.parseJSON(reviewResultClean)
    } catch {
      callbacks.log(t('reviewChapter.parseFailed'))
      parsedResult = { summary: t('reviewChapter.parseFallback'), items: [] }
    }

    await ipc.invoke('db:review-create', {
      baseDraftId: baseDraft.id,
      reviewIndex: revIndex,
      content: JSON.stringify(parsedResult, null, 2),
    })

    // 将审稿报告 JSON 序列化为字符串，作为 content 传给 Tab
    // EditorArea 渲染 ReviewReport 的条件：activeTab.content 存在
    const reportContent = JSON.stringify(parsedResult, null, 2)

    const { useEditorStore } = await import('../../../stores/editor-store')
    const pseudoReviewPath = `vela://draft/ch${this.params.chapterNumber}/v${baseVersion}/review${revIndex}`
    useEditorStore.getState().openFile({
      id: `review-${this.params.draftPath}-${revIndex}`,
      name: t('reviewChapter.tabName', { chapter: this.params.chapterNumber }),
      type: 'review-report',
      content: reportContent,
      filePath: this.params.draftPath,
      reportPath: pseudoReviewPath,
      reviewReport: reportContent,
      chapterNumber: this.params.chapterNumber,
    })

    callbacks.log(t('reviewChapter.completed', { version: revIndex }))
    return reviewResultClean
  }

  private async readCharacterStates(): Promise<string> {
    try {
      const allChars = await ipc.invoke('db:character-get-all')
      const states: string[] = []
      for (const card of allChars) {
        if (card.name && card.currentState) {
          const cs = card.currentState
          states.push(`${card.name}（${card.role || '未知'}）: ${cs.powerLevel || ''}, ${cs.location || ''}, ${cs.physicalState || ''}, ${cs.mentalState || ''}, 最近：${cs.recentEvents || ''}`)
        }
      }
      return states.length > 0 ? states.join('\n') : t('reviewChapter.noData')
    } catch { return t('reviewChapter.readFailed') }
  }

  private async readWorldBuilding(): Promise<string> {
    const core = await ipc.invoke('db:project-core-get')
    return core?.worldbuilding || t('reviewChapter.noData')
  }
}
