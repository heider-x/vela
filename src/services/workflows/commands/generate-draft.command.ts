import { BaseWorkflowCommand, CommandExecuteParams } from './base-command'
import { useProjectStore } from '../../../stores/project-store'
import { getPromptTemplate } from '../../prompt-templates'
import { ChapterPromptBuilder } from '../../prompts/prompt-builder'
import { ipc } from '../../ipc-client'
import {
  DIR_PROMPTS
} from '../../../shared/project-paths'
import type { ChapterInfo } from '../chapter-workflow'
import {
  buildCanonContext,
  renderCanonContext,
  runConsistencyGate,
} from '../../narrative-consistency'

export class GenerateDraftCommand extends BaseWorkflowCommand {

  constructor(private chapterInfo: ChapterInfo) {
    super()
  }

  async execute({ context, callbacks }: CommandExecuteParams): Promise<string> {
    const project = useProjectStore.getState().currentProject
    if (!project) throw new Error('未打开项目')

    callbacks.log('拼装章节上下文 (强类型注入中)...')

    const architecture = await this.readArchitecture(project.path)
    const projectPrompts = await this.readProjectPrompts(project.path)
    const mergedGuidance = [project.novelConfig.globalGuidance || '', projectPrompts].filter(Boolean).join('\n\n')

    const characterState = await this.readCharacterStates(project.path)
    const allCharacters = await ipc.invoke('db:character-get-all').catch(() => [] as Array<{ name: string; role: string; currentState?: { location?: string; powerLevel?: string; physicalState?: string; mentalState?: string; keyItems?: string; recentEvents?: string; updatedAtChapter?: number } }>)
    let futureBlueprintsStr = '（无后续蓝图）'
    try {
      const { loadDirectoryBlueprints } = await import('../directory-workflow')
      const allBlueprints = await loadDirectoryBlueprints()
      const futureBlueprintsArr = allBlueprints.filter(
        b => b.chapterNumber > this.chapterInfo.chapterNumber && b.chapterNumber <= this.chapterInfo.chapterNumber + 5
      )
      if (futureBlueprintsArr.length > 0) {
        futureBlueprintsStr = futureBlueprintsArr.map(b => `第${b.chapterNumber}章 ${b.title}：${b.keyEvents}`).join('\n')
      }
    } catch { /* 忽略 */ }

    // ==========================================
    // [Canon] 构造叙事一致性 Canon Context（所有生成路径都强制经过此闸门）
    // ==========================================
    let canonRendered = ''
    let canonForValidation: import('../../narrative-consistency').CanonContext | null = null
    try {
      const core = await ipc.invoke('db:project-core-get').catch(() => null as null | { premise?: string; charactersArch?: string; worldbuilding?: string; synopsis?: string })
      // 拆解 architecture 字符串回填到结构化字段（architecture 由 readArchitecture 按 premise/charactersArch/worldbuilding/synopsis 顺序拼装）
      const archParts = (architecture || '').split(/\n\n---\n\n/)
      canonForValidation = await buildCanonContext({
        chapterNumber: this.chapterInfo.chapterNumber,
        architecture: {
          premise: core?.premise ?? archParts[0] ?? '',
          charactersArch: core?.charactersArch ?? archParts[1] ?? '',
          worldbuilding: core?.worldbuilding ?? archParts[1] ?? '',
          synopsis: core?.synopsis ?? archParts[3] ?? '',
        },
        characters: (allCharacters || []).map(c => ({
          name: c.name,
          role: c.role,
          currentState: c.currentState,
        })),
        chapterGoal: typeof this.chapterInfo === 'object' ? JSON.stringify(this.chapterInfo) : String(this.chapterInfo),
        previousEnding: '', // 下面在非首章分支填充
        ragContext: '',     // 下面在非首章分支填充
        writingStyle: project.novelConfig.writingStyle || '',
        globalGuidance: mergedGuidance,
      })
      canonRendered = renderCanonContext(canonForValidation)
      callbacks.log(`  🛡️ 已注入 Canon 上下文（时间线 ${canonForValidation.timeline.length} 条 / 角色状态 ${canonForValidation.characterStates.length} 条 / 剧情线 ${canonForValidation.openPlotLines.length} 条）`)
    } catch (e) {
      callbacks.log(`  ⚠️ Canon 上下文构造失败，继续以基础上下文生成：${String(e)}`)
    }
    const isFirstChapter = this.chapterInfo.chapterNumber === 1
    const templateKey = isFirstChapter ? 'first_chapter_draft' : 'next_chapter_draft'
    const template = getPromptTemplate(templateKey)
    if (!template) throw new Error(`未找到模板: ${templateKey}`)

    // ==========================================
    // Prompt 构建——按「稳定前缀 → 可变后缀」排列
    // 以最大化 LLM 上下文缓存命中率
    // ==========================================
    const promptBuilder = new ChapterPromptBuilder(template)
      // ---- 缓存命中区（跨章稳定，前缀对齐）----
      .withArchitecture(architecture)
      .withGlobalGuidance(mergedGuidance)
      .withWritingStyle(project.novelConfig.writingStyle || '')
      .withNovelConfig(project.novelConfig)
      .withWordNumber(project.novelConfig.wordsPerChapter)

    if (!isFirstChapter) {
      // 从蓝图 JSON 的 notes 字段读取章节要点时间线（按序拼装，利于前缀缓存）
      const chapterTimeline = await this.readChapterNotesTimeline(project.path, this.chapterInfo.chapterNumber)
      callbacks.log(`  📋 已加载章节要点时间线（${chapterTimeline.length} 字）`)

      let previousEnding = ''
      try {
        const prevNum = this.chapterInfo.chapterNumber - 1
        const meta = await ipc.invoke('db:draft-get-finalized', prevNum)
        if (meta) {
          const full = await ipc.invoke('db:draft-get-full', meta.id)
          if (full?.content) previousEnding = full.content.slice(-1000)
        }
      } catch { /* 忽略 */ }

      let filteredContext = ''
      try {
        callbacks.log('  🔍 检索知识库相关片段...')
        let searchQuery = `${this.chapterInfo.title} ${this.chapterInfo.keyEvents} ${this.chapterInfo.characters.join(' ')}`
        if (this.chapterInfo.knowledgeQueryHint?.trim()) {
          searchQuery += ` ${this.chapterInfo.knowledgeQueryHint.trim()}`
          callbacks.log(`  📌 追加用户检索关键词：${this.chapterInfo.knowledgeQueryHint.trim()}`)
        }
        const results = await ipc.invoke('kb:search', searchQuery, 5)
        filteredContext = results.length > 0
          ? results.map((r: { fileName: string; score: number; text: string }, i: number) => `[${i + 1}] (${r.fileName}, 相关度 ${(r.score * 100).toFixed(0)}%)\n${r.text}`).join('\n\n')
          : '（知识库中无相关内容）'
      } catch {
        filteredContext = '（知识库检索不可用）'
      }

      promptBuilder
        // ---- 缓存命中区续（要点时间线按序追加，前缀对齐）----
        .withGlobalSummary(chapterTimeline)
        .withCharacterStates(characterState)
        // ---- 缓存失效区（逐章变化）----
        .withPreviousEnding(previousEnding || '（无前文）')
        .withChapterInfo(this.chapterInfo)
        .withFutureBlueprints(futureBlueprintsStr)
        .withFilteredContext(filteredContext)
        .withShortSummary('')
        .withUserGuidance(this.chapterInfo.userGuidance?.trim() || '（无微操指导）')

      // [Canon] 二次注入：在 RAG 与上一章结尾就绪后，把它们写回 Canon 并重渲染
      if (canonForValidation) {
        canonForValidation.previousEnding = previousEnding || '（无前文）'
        canonForValidation.ragContext = filteredContext || '（无 RAG 检索结果）'
        canonRendered = renderCanonContext(canonForValidation)
      }
    }

    // [Canon] 注入叙事一致性上下文（强制最高优先级）
    if (canonRendered) {
      promptBuilder.withCanonContext(canonRendered)
    }

    // Token 预算管控：中文约 1.5 字符/token，预留 4K 给输出
    const prompt = promptBuilder.build()
    const estimatedTokens = Math.ceil(prompt.length / 1.5)
    const TOKEN_BUDGET = 28000
    if (estimatedTokens > TOKEN_BUDGET) {
      callbacks.log(`⚠️ Prompt 预估 ${estimatedTokens} tokens，超出预算 ${TOKEN_BUDGET}，请考虑精简上下文`)
    }

    callbacks.log('调用 AI 生成章节草稿...')

    const draftText = await this.callLLMWithBuilder(promptBuilder, callbacks)
    const cleanDraftText = this.stripThinkingTags(draftText)

    // ==========================================
    // [Canon] 生成后一致性 Gate + 自动修复
    // ==========================================
    let finalDraft = cleanDraftText
    if (canonForValidation) {
      try {
        const gateResult = await runConsistencyGate({
          chapterNumber: this.chapterInfo.chapterNumber,
          chapterContent: cleanDraftText,
          canon: canonForValidation,
        })
        callbacks.log(`  🛡️ [Gate] ${gateResult.verdict}: ${gateResult.report}`)
        if (gateResult.verdict === 'BLOCK') {
          throw new Error(`生成草稿被叙事一致性 Gate 阻止：${gateResult.blockingReasons.join('；')}`)
        }
        if (gateResult.verdict === 'REPAIR' && gateResult.repairedContent) {
          finalDraft = gateResult.repairedContent
          callbacks.log(`  🛡️ [Canon] 自动修复 ${gateResult.repairAttempts} 轮后保存修复稿`)
        }
        if (gateResult.issues.length === 0) {
          callbacks.log(`  ✅ [Canon] 一致性检查通过`)
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
        callbacks.log(`  ❌ [Canon] Gate 异常：${String(e)}`)
        throw e
      }
    }

    // 落于数据库
    const nextVersion: number = await ipc.invoke('db:draft-next-version', this.chapterInfo.chapterNumber)
    const createResult = await ipc.invoke('db:draft-create', {
      chapterNumber: this.chapterInfo.chapterNumber,
      version: nextVersion,
      source: 'write',
      content: finalDraft,
      wordCount: finalDraft.length,
    })

    const pseudoPath = createResult.id ? `vela://draft/${createResult.id}` : `vela://draft/ch${this.chapterInfo.chapterNumber}/v${nextVersion}`

    context.data.draft = finalDraft
    context.data.draftContent = finalDraft
    context.data.draftPath = pseudoPath
    context.data.chapterNumber = this.chapterInfo.chapterNumber
    context.data.chapterInfo = this.chapterInfo
    context.data.mergedGuidance = mergedGuidance
    context.data.shortSummary = ''

    useProjectStore.getState().refreshFileTree()
    try {
      const { useDraftStore } = await import('../../../stores/draft-store')
      await useDraftStore.getState().loadAllDrafts()
    } catch { /* 忽略 */ }

    try {
      const { useEditorStore } = await import('../../../stores/editor-store')
      useEditorStore.getState().openFile({
        id: pseudoPath,
        name: `第${this.chapterInfo.chapterNumber}章 ${this.chapterInfo.title} v${nextVersion}`,
        type: 'chapter',
        filePath: pseudoPath,
        content: cleanDraftText,
      })
    } catch { /* 忽略 */ }

    callbacks.log(`✅ 草稿已自动入库保存为版本 v${nextVersion}（${draftText.length} 字）`)
    return draftText
  }

  // --- 抽取自原文件的辅助方法 ---
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async readArchitecture(_projectPath: string): Promise<string> {
    const core = await ipc.invoke('db:project-core-get')
    const parts: string[] = []
    if (core?.premise) parts.push(core.premise.trim())
    if (core?.charactersArch) parts.push(core.charactersArch.trim())
    if (core?.worldbuilding) parts.push(core.worldbuilding.trim())
    if (core?.synopsis) parts.push(core.synopsis.trim())
    return parts.join('\n\n---\n\n')
  }

  private async readProjectPrompts(projectPath: string): Promise<string> {
    try {
      const files = await ipc.invoke('fs:list-dir', `${projectPath}/${DIR_PROMPTS}`)
      const mdFiles = files.filter((f: { isDir: boolean; name: string }) => !f.isDir && f.name.endsWith('.md'))
      if (mdFiles.length === 0) return ''
      const parts: string[] = []
      for (const f of mdFiles) {
        const result = await ipc.invoke('fs:read-file', f.path)
        if (result.success && result.content.trim()) {
          parts.push(`## 项目专属指导（${f.name.replace(/\.md$/, '')}）\n${result.content.trim()}`)
        }
      }
      return parts.join('\n\n')
    } catch { return '' }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async readCharacterStates(_projectPath: string): Promise<string> {
    try {
      const allChars = await ipc.invoke('db:character-get-all')
      const states: string[] = []
      for (const card of allChars) {
        if (card.name && card.currentState) {
          const cs = card.currentState
          states.push(
            `${card.name}（${card.role || '未知'}）| ` +
            `境界：${cs.powerLevel || '未知'} | ` +
            `位置：${cs.location || '未知'} | ` +
            `身体：${cs.physicalState || '正常'} | ` +
            `心理：${cs.mentalState || '正常'} | ` +
            `道具：${cs.keyItems || '无'} | ` +
            `最近：第${cs.updatedAtChapter || 0}章 ${cs.recentEvents || ''}`
          )
        }
      }
      return states.length > 0 ? `【角色状态档案】\n${states.join('\n')}` : '（暂无角色状态档案）'
    } catch { return '（角色状态档案读取失败）' }
  }

  /**
   * 从蓝图 JSON 的 notes 字段读取章节要点时间线。
   * 近 5 章完整收录；更早期仅保留标题行，控制总量 ≤ 3000 字。
   * 按序拼装保证前缀稳定，最大化 LLM 上下文缓存命中。
   */
  private async readChapterNotesTimeline(_projectPath: string, currentChapter: number): Promise<string> {
    const FULL_WINDOW = 5  // 近 N 章完整收录
    const MAX_CHARS = 3000 // 总量上限
    const lines: string[] = []

    for (let i = 1; i < currentChapter; i++) {
      try {
        const bp = await ipc.invoke('db:blueprint-get', i)
        if (!bp) continue
        const isRecent = i >= currentChapter - FULL_WINDOW

        if (isRecent && bp.notes?.trim()) {
          // 近 N 章：完整收录要点
          lines.push(`【第${i}章 ${bp.title || ''}】\n${bp.notes.trim()}`)
        } else {
          // 远期章节：仅保留标题行（节省 Token）
          lines.push(`【第${i}章 ${bp.title || ''}】`)
        }
      } catch { /* 忽略单章读取失败 */ }
    }

    // Token 预算控制：超限时从最早的完整要点开始精简
    let result = lines.join('\n\n')
    if (result.length > MAX_CHARS) {
      // 保留近章完整内容，远期章节已经是标题行了
      result = result.slice(-MAX_CHARS)
    }

    return result || '（无章节要点）'
  }
}
