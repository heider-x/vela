import { BaseWorkflowCommand, CommandExecuteParams } from './base-command'
import { useProjectStore } from '../../../stores/project-store'
import { getPromptTemplate } from '../../prompt-templates'
import { ReviewPromptBuilder } from '../../prompts/prompt-builder'
import { ipc } from '../../ipc-client'
import { buildCanonContext, renderCanonContext } from '../../narrative-consistency'


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
    if (!project) throw new Error('未打开项目')

    const draft = this.params.draftContent
    if (!draft) throw new Error('无草稿内容')

    callbacks.log('准备启动一致性审查引擎...')
    callbacks.log('  检索全书设定档案...')

    // 使用向量检索获取与待审章节相关的历史上下文（替代全局摘要）
    let contextSummary = '（无上下文参考）'
    try {
      // 从待审内容中提取前 200 字作为检索 query
      const queryText = draft.slice(0, 200)
      const results = await ipc.invoke('kb:search', queryText, 5)
      if (results.length > 0) {
        contextSummary = results
          .map((r: { fileName: string; score: number; text: string }, i: number) =>
            `[${i + 1}] (${r.fileName}, 相关度 ${(r.score * 100).toFixed(0)}%)\n${r.text}`)
          .join('\n\n')
      }
    } catch {
      contextSummary = '（知识库检索不可用）'
    }

    const characterState = await this.readCharacterStates()
    const worldBuilding = await this.readWorldBuilding()

    const template = getPromptTemplate('consistency_check')
    if (!template) throw new Error('未找到审稿模板')

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
      callbacks.log(`  🛡️ [Canon] 审稿已注入事实基线（时间线 ${canon.timeline.length} / 角色 ${canon.characterStates.length}）`);
    } catch (e) {
      promptBuilder = new ReviewPromptBuilder(template);
      callbacks.log(`  ⚠️ [Canon] 审稿上下文构造失败：${String(e)}`);
    }

    promptBuilder
      .withChapterContent(draft)
      .withCharacterStates(characterState)
      .withGlobalSummary(contextSummary)
      .withWorldBuilding(worldBuilding)
      .withReviewFocus(this.params.reviewFocus || '');

    callbacks.log('调用 AI 审查员对本章进行多维度扫描...')

    // 期望 JSON 格式返回
    const reviewResultRaw = await this.callLLMWithBuilder(
      promptBuilder,
      callbacks,
      { responseFormat: { type: 'json_object' } }
    )

    const reviewResultClean = this.stripThinkingTags(reviewResultRaw)

    const { parseDraftMeta } = await import('../chapter-workflow')
    const baseDraft = await parseDraftMeta(this.params.draftPath)
    if (!baseDraft) throw new Error('找不到基准草稿版本')
    const baseVersion = baseDraft.version

    const revIndex = await ipc.invoke('db:review-next-index', baseDraft.id)

    let parsedResult
    try {
      parsedResult = this.parseJSON(reviewResultClean)
    } catch {
      callbacks.log('⚠️ 审稿结果解析失败，返回原始文本')
      parsedResult = { summary: '解析失败', items: [] }
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
      name: `审稿报告：第${this.params.chapterNumber}章`,
      type: 'review-report',
      content: reportContent,
      filePath: this.params.draftPath,
      reportPath: pseudoReviewPath,
      reviewReport: reportContent,
      chapterNumber: this.params.chapterNumber,
    })

    callbacks.log(`✅ 审查完成，已生成审稿报告 r${revIndex}`)
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
      return states.length > 0 ? states.join('\n') : '（暂无）'
    } catch { return '（读取失败）' }
  }

  private async readWorldBuilding(): Promise<string> {
    const core = await ipc.invoke('db:project-core-get')
    return core?.worldbuilding || '（暂无）'
  }
}
