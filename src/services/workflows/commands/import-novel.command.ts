/**
 * 导入小说 — Command 集合
 *
 * 三个独立 Command 组成逆向推演全链路：
 * 1. ImportInitializeCommand — 写入正文 + 构建知识库
 * 2. InferGlobalSettingsCommand — 向量采样 + AI 推演全局配置/架构/角色
 * 3. InferBlueprintsPerChapterCommand — 按章逐一推演精准蓝图 + 蓝图入向量库 + 拼装轻量全局摘要
 */

import { BaseWorkflowCommand, CommandExecuteParams } from './base-command'
import { useProjectStore } from '../../../stores/project-store'
import { getPromptTemplate } from '../../prompt-templates'
import { ImportPromptBuilder } from '../../prompts/prompt-builder'
import { ipc } from '../../ipc-client'
import i18n from '../../../i18n'
import type { CharacterData } from '../../../../electron/repositories/character-repository'

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, { ns: 'commands', ...opts })

/** 拆分后的章节数据（从 context.data 中传递） */
export interface ImportedChapter {
  number: number
  title: string
  content: string
  wordCount: number
}

// =================================================================
// 1. 初始化：写入正文 + 构建知识库
// =================================================================

export class ImportInitializeCommand extends BaseWorkflowCommand<void> {
  constructor(private chapters: ImportedChapter[]) {
    super()
  }

  async execute({ context, callbacks }: CommandExecuteParams): Promise<void> {
    const project = useProjectStore.getState().currentProject
    if (!project) throw new Error(t('common.noProject'))

    callbacks.log(t('importNovel.importingChapters', { count: this.chapters.length }))
    callbacks.setProgress(5)

    // 1. 批量创建草稿并标记为 finalized
    for (let i = 0; i < this.chapters.length; i++) {
      const ch = this.chapters[i]

      // 直接调用 DB 写库（来源设为 write）
      await ipc.invoke('db:draft-create', {
        chapterNumber: ch.number,
        version: 1,
        content: ch.content,
        wordCount: ch.wordCount,
        source: 'write'
      })

      if (i % 10 === 0) {
        callbacks.setProgress(5 + Math.round((i / this.chapters.length) * 40))
        callbacks.log(t('importNovel.importedChapter', { chapter: ch.number, words: ch.wordCount }))
      }
    }
    callbacks.log(t('importNovel.allChaptersImported', { count: this.chapters.length }))
    callbacks.setProgress(45)

    // 2. 逐章导入知识库（向量化）
    callbacks.log(t('importNovel.buildingKB'))
    let successCount = 0
    let failCount = 0
    for (let i = 0; i < this.chapters.length; i++) {
      const ch = this.chapters[i]
      try {
        const fileName = ch.title
          ? `第${ch.number}章 ${ch.title}.txt`
          : `chapter_${ch.number}.txt`
        const result = await ipc.invoke('kb:import-text', ch.content, fileName, project.path) as { success: boolean; error?: string }
        if (result.success) {
          successCount++
        } else {
          callbacks.log(t('importNovel.kbImportFailed', { file: fileName, error: result.error }))
          failCount++
        }
      } catch {
        failCount++
      }
      if (i % 10 === 0) {
        callbacks.setProgress(45 + Math.round((i / this.chapters.length) * 45))
      }
    }
    callbacks.log(t('importNovel.kbBuilt', { success: successCount, fail: failCount }))
    callbacks.setProgress(90)

    // 将章节数据存入 context 供后续步骤使用
    context.data.chapters = this.chapters
    context.data.totalChapters = this.chapters.length

    // 刷新文件树
    useProjectStore.getState().refreshFileTree()
  }
}

// =================================================================
// 2. 向量采样 + AI 推演全局配置/架构/角色
// =================================================================

export class InferGlobalSettingsCommand extends BaseWorkflowCommand<void> {
  async execute({ context, callbacks }: CommandExecuteParams): Promise<void> {
    const project = useProjectStore.getState().currentProject
    if (!project) throw new Error(t('common.noProject'))

    const chapters = context.data.chapters as ImportedChapter[]
    if (!chapters || chapters.length === 0) throw new Error(t('importNovel.noChapterData'))

    callbacks.log(t('importNovel.searchingFragments'))
    callbacks.setProgress(5)

    // ===== 向量检索采样 =====
    const searchTopics = [
      { key: 'worldview', query: '世界观 力量体系 修炼等级 境界', labelKey: 'importNovel.searchTopicWorldview' },
      { key: 'protagonist', query: '主角 金手指 核心能力 天赋 系统', labelKey: 'importNovel.searchTopicProtagonist' },
      { key: 'conflict', query: '敌人 反派 阴谋 危机 矛盾 对手', labelKey: 'importNovel.searchTopicConflict' },
      { key: 'style', query: '视角 叙述 描写 风格 节奏', labelKey: 'importNovel.searchTopicStyle' },
    ]

    const sampledContent: Record<string, string> = {}
    for (const topic of searchTopics) {
      try {
        const results = await ipc.invoke('kb:search', topic.query, 5)
        if (results.length > 0) {
          sampledContent[topic.key] = results
            .map((r: { text: string; score: number; fileName: string }, i: number) =>
              `[${i + 1}] (${r.fileName}, 相关度 ${(r.score * 100).toFixed(0)}%)\n${r.text}`
            ).join('\n\n')
        } else {
          sampledContent[topic.key] = t('importNovel.noRelevantContent')
        }
        callbacks.log(t('importNovel.retrievedTopic', { label: t(topic.labelKey), count: results.length }))
      } catch {
        sampledContent[topic.key] = t('importNovel.vectorSearchUnavailable')
        callbacks.log(t('importNovel.topicSearchFailed', { label: t(topic.labelKey) }))
      }
    }
    callbacks.setProgress(20)

    // ===== 构建 Prompt =====
    // 优先使用向量增强版 Prompt
    const template = getPromptTemplate('infer_novel_config_with_vectors')
      || getPromptTemplate('infer_novel_config')
    if (!template) throw new Error(t('importNovel.templateNotFound'))

    const firstChapter = chapters[0]?.content?.slice(0, 3000) || t('importNovel.firstChapterUnavailable')
    const latestChapter = chapters[chapters.length - 1]?.content?.slice(0, 3000) || t('importNovel.latestChapterUnavailable')

    const prompt = new ImportPromptBuilder(template)
      .withSampledWorldview(sampledContent.worldview || '')
      .withSampledProtagonist(sampledContent.protagonist || '')
      .withSampledConflict(sampledContent.conflict || '')
      .withSampledStyle(sampledContent.style || '')
      .withFirstChapter(firstChapter)
      .withLatestChapter(latestChapter)
      .withTotalChapters(chapters.length)
      // 兼容旧版 Prompt 的 sample_content 变量
      .withSampleContent(`【第1章片段】\n${firstChapter}\n\n【最新章节片段】\n${latestChapter}`)
      .build()

    callbacks.log(t('importNovel.inferringConfig'))
    callbacks.setProgress(25)

    const rawResult = await this.callLLM(
      prompt,
      template.systemRole || '你是一位顶级网文主编和资深阅读分析师。',
      callbacks,
      { responseFormat: { type: 'json_object' } }
    )

    callbacks.setProgress(70)
    callbacks.log(t('importNovel.parsingResult'))

    // ===== 解析 JSON 结果 =====
    const inferResult = this.parseJSON<{
      novelConfig: Record<string, string>
      architectureFiles: Record<string, string>
      characterCards: Array<Record<string, unknown>>
    }>(rawResult)

    // ===== 写入小说配置 =====
    if (inferResult.novelConfig) {
      const novelConfig = {
        ...project.novelConfig,
        ...inferResult.novelConfig,
        totalChapters: chapters.length,
        wordsPerChapter: Math.round(chapters.reduce((s, c) => s + c.wordCount, 0) / chapters.length),
      }
      // 更新内存
      useProjectStore.getState().updateNovelConfig(novelConfig)
      // 持久化到 config 文件
      const updatedProject = useProjectStore.getState().currentProject
      if (updatedProject) {
        // 仅提取 ProjectData 字段，防止 structured clone 序列化异常
        const plainData = {
          id: updatedProject.id,
          name: updatedProject.name,
          path: updatedProject.path,
          novelConfig: { ...updatedProject.novelConfig },
          characterStates: updatedProject.characterStates,
          createdAt: updatedProject.createdAt,
          updatedAt: updatedProject.updatedAt,
        }
        await ipc.invoke('project:save', plainData.id, plainData)
      }
      callbacks.log(t('importNovel.configUpdated'))

      // 生成配置摘要供后续步骤使用
      const noneLabel = t('importNovel.novelConfigSummaryNone')
      context.data.novelConfigSummary =
        `${t('importNovel.novelConfigSummaryGenre', { value: novelConfig.genre || noneLabel })} | ` +
        `${t('importNovel.novelConfigSummarySubGenre', { value: novelConfig.subGenre || noneLabel })} | ` +
        `${t('importNovel.novelConfigSummaryAudience', { value: novelConfig.targetAudience || noneLabel })}\n` +
        `${t('importNovel.novelConfigSummaryOutline', { value: novelConfig.coreOutline || noneLabel })}\n` +
        `${t('importNovel.novelConfigSummaryWorldSetting', { value: novelConfig.worldSetting || noneLabel })}\n` +
        `${t('importNovel.novelConfigSummaryGoldenFinger', { value: novelConfig.goldenFinger || noneLabel })}\n` +
        `${t('importNovel.novelConfigSummaryProtagonist', { value: novelConfig.protagonistProfile || noneLabel })}`
    }

    // ===== 写入架构信息 =====
    if (inferResult.architectureFiles) {
      await ipc.invoke('db:project-core-update', {
        premise: inferResult.architectureFiles.premise,
        charactersArch: inferResult.architectureFiles.characters,
        worldbuilding: inferResult.architectureFiles.world,
        synopsis: inferResult.architectureFiles.synopsis,
      })
      callbacks.log(t('importNovel.architecturePersisted'))
    }

    // ===== 写入角色卡 =====
    if (inferResult.characterCards && Array.isArray(inferResult.characterCards)) {
      let createdCount = 0
      const cardsToSave: CharacterData[] = []
      for (const card of inferResult.characterCards) {
        if (!card.name) continue
        const validRoles = ['protagonist', 'antagonist', 'supporting', 'minor']
        const role = validRoles.includes(card.role as string) ? card.role : 'supporting'
        cardsToSave.push({
          name: card.name as string,
          role: role as 'protagonist' | 'antagonist' | 'supporting' | 'minor',
          gender: (card.gender as string) || '',
          age: (card.age as string) || '',
          appearance: (card.appearance as string) || '',
          personality: (card.personality as string) || '',
          background: (card.background as string) || '',
          abilities: (card.abilities as string) || '',
          motivation: (card.motivation as string) || '',
          relationships: (card.relationships as string) || '',
          arc: (card.arc as string) || '',
          notes: (card.notes as string) || ''
        })
        createdCount++
      }
      if (cardsToSave.length > 0) {
        await ipc.invoke('db:character-save-all', cardsToSave)
      }
      callbacks.log(t('importNovel.cardsGenerated', { count: createdCount }))
    }

    callbacks.setProgress(90)
    this.notifyRefresh(['fileTree', 'characterCards'])
  }
}


// =================================================================
// 3. 按章逐一推演精准蓝图（限流并发）
// =================================================================

export class InferBlueprintsPerChapterCommand extends BaseWorkflowCommand<void> {
  /** 最大并发数，防止触发模型提供商 Rate Limit */
  private static readonly CONCURRENCY_LIMIT = 3

  async execute({ context, callbacks }: CommandExecuteParams): Promise<void> {
    const project = useProjectStore.getState().currentProject
    if (!project) throw new Error(t('common.noProject'))

    const chapters = context.data.chapters as ImportedChapter[]
    const configSummary = (context.data.novelConfigSummary as string) || t('importNovel.configSummaryUnavailable')
    if (!chapters || chapters.length === 0) throw new Error(t('importNovel.noChapterData'))

    const template = getPromptTemplate('infer_single_chapter_blueprint')
    if (!template) throw new Error(t('importNovel.singleChapterTemplateNotFound'))

    callbacks.log(t('importNovel.inferringBlueprints', { count: chapters.length, limit: InferBlueprintsPerChapterCommand.CONCURRENCY_LIMIT }))
    callbacks.setProgress(5)

    let completedCount = 0
    let failedCount = 0

    // 限流并发执行器
    const runWithConcurrency = async (tasks: (() => Promise<void>)[], limit: number) => {
      const executing = new Set<Promise<void>>()
      for (const task of tasks) {
        const p = task().then(() => { executing.delete(p) })
        executing.add(p)
        if (executing.size >= limit) {
          await Promise.race(executing)
        }
      }
      await Promise.all(executing)
    }

    const tasks = chapters.map((ch) => async () => {
      try {
        const prompt = new ImportPromptBuilder(template)
          .withChapterContent(ch.content.slice(0, 6000)) // 限制单章 Prompt 长度
          .withChapterNumber(ch.number)
          .withChapterTitle(ch.title)
          .withNovelConfigSummary(configSummary)
          .build()

        const rawResult = await this.callLLM(
          prompt,
          template.systemRole || '你是一位专业的网文结构分析师。',
          callbacks,
          { responseFormat: { type: 'json_object' } }
        )

        const blueprint = this.parseJSON<Record<string, unknown>>(rawResult)

        // 确保必要字段
        const finalBlueprint = {
          chapterNumber: ch.number,
          title: (blueprint.title as string) || ch.title,
          role: (blueprint.role as string) || '发展',
          purpose: (blueprint.purpose as string) || '',
          keyEvents: (blueprint.keyEvents as string) || '',
          characters: Array.isArray(blueprint.characters) ? blueprint.characters as string[] : [],
          suspenseHook: (blueprint.suspenseHook as string) || '',
          userGuidance: '',
          notes: '',
          notesUpdatedAt: '',
        }

        await ipc.invoke('db:blueprint-upsert', finalBlueprint)

        completedCount++
        callbacks.log(t('importNovel.blueprintGenerated', { chapter: ch.number }))
      } catch (err) {
        failedCount++
        callbacks.log(t('importNovel.blueprintFailed', { chapter: ch.number, error: err instanceof Error ? err.message : String(err) }))
      }

      // 更新进度
      const total = chapters.length
      const done = completedCount + failedCount
      callbacks.setProgress(5 + Math.round((done / total) * 90))
    })

    await runWithConcurrency(tasks, InferBlueprintsPerChapterCommand.CONCURRENCY_LIMIT)

    callbacks.log(`\n${t('importNovel.blueprintSummary')}`)
    callbacks.log(t('importNovel.blueprintSummaryLine', { success: completedCount, fail: failedCount }))
    callbacks.setProgress(85)

    callbacks.setProgress(100)
    this.notifyRefresh(['fileTree', 'blueprints'])
  }
}
