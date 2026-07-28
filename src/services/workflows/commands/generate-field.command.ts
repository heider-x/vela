import { BaseWorkflowCommand, CommandExecuteParams } from './base-command'
import { useProjectStore } from '../../../stores/project-store'
import type { NovelConfig } from '../../../shared/ipc-channels'
import i18n from '../../../i18n'

/**
 * 支持的单字段生成 Key
 * 每个 key 对应 NovelConfig 中的一个文本字段
 */
export type GeneratableField =
  | 'coreOutline'
  | 'worldSetting'
  | 'goldenFinger'
  | 'protagonistProfile'
  | 'globalGuidance'
  | 'writingStyle'

/** 字段标签 (i18n) */
const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, { ns: 'commands', ...opts })
const getFieldLabel = (key: GeneratableField): string => t(`generateField.${key}`)

/**
 * 单字段 AI 生成命令
 * 根据已有的 NovelConfig 上下文，只生成指定字段的内容
 */
export class GenerateFieldCommand extends BaseWorkflowCommand<string> {
  constructor(private fieldKey: GeneratableField) {
    super()
  }

  async execute({ callbacks }: CommandExecuteParams): Promise<string> {
    const project = useProjectStore.getState().currentProject
    if (!project) throw new Error(t('common.noProject'))

    const config = project.novelConfig
    const label = getFieldLabel(this.fieldKey)

    callbacks.log(t('generateField.generating', { label }))

    // 构建上下文摘要（已填写的字段作为参考）
    const context = this.buildContext(config)
    // 构建针对性 prompt
    const prompt = this.buildPrompt(config, context)
    const systemPrompt = t('generateField.systemRole')

    const result = await this.callLLM(prompt, systemPrompt, callbacks)
    const cleanResult = this.stripThinkingTags(result).trim()

    if (!cleanResult) {
      callbacks.log(t('generateField.emptyResult', { label }))
      return ''
    }

    // 写入 NovelConfig
    const { updateNovelConfig, saveProject } = useProjectStore.getState()
    updateNovelConfig({ [this.fieldKey]: cleanResult })
    await saveProject()
    callbacks.log(t('generateField.saved', { label }))

    return cleanResult
  }

  /** 构建已有配置的上下文摘要 */
  private buildContext(config: NovelConfig): string {
    const parts: string[] = []
    if (config.genre) parts.push(t('generateField.contextGenre', { value: config.genre }))
    if (config.subGenre) parts.push(t('generateField.contextSubGenre', { value: config.subGenre }))
    if (config.targetAudience) parts.push(t('generateField.contextAudience', { value: config.targetAudience }))
    if (config.totalChapters) parts.push(t('generateField.contextChapters', { value: config.totalChapters }))
    if (config.wordsPerChapter) parts.push(t('generateField.contextWordsPerChapter', { value: config.wordsPerChapter }))
    if (config.coreOutline?.trim() && this.fieldKey !== 'coreOutline')
      parts.push(t('generateField.contextOutline', { value: config.coreOutline.slice(0, 500) }))
    if (config.worldSetting?.trim() && this.fieldKey !== 'worldSetting')
      parts.push(t('generateField.contextWorldSetting', { value: config.worldSetting.slice(0, 500) }))
    if (config.goldenFinger?.trim() && this.fieldKey !== 'goldenFinger')
      parts.push(t('generateField.contextGoldenFinger', { value: config.goldenFinger.slice(0, 500) }))
    if (config.protagonistProfile?.trim() && this.fieldKey !== 'protagonistProfile')
      parts.push(t('generateField.contextProtagonist', { value: config.protagonistProfile.slice(0, 500) }))
    if (config.globalGuidance?.trim() && this.fieldKey !== 'globalGuidance')
      parts.push(t('generateField.contextGlobalGuidance', { value: config.globalGuidance.slice(0, 500) }))
    if (config.referenceWorks?.trim())
      parts.push(t('generateField.contextReferenceWorks', { value: config.referenceWorks }))
    if (config.writingStyle?.trim() && this.fieldKey !== 'writingStyle')
      parts.push(t('generateField.contextWritingStyle', { value: config.writingStyle.slice(0, 300) }))
    return parts.length > 0 ? parts.join('\n') : t('generateField.noConfigYet')
  }

  /** 根据 fieldKey 构建针对性 prompt */
  private buildPrompt(config: NovelConfig, context: string): string {
    const fieldPrompts: Record<GeneratableField, string> = {
      coreOutline: t('generateField.promptCoreOutline'),
      worldSetting: t('generateField.promptWorldSetting'),
      goldenFinger: t('generateField.promptGoldenFinger'),
      protagonistProfile: t('generateField.promptProtagonistProfile'),
      globalGuidance: t('generateField.promptGlobalGuidance', { chapters: config.totalChapters || 100 }),
      writingStyle: t('generateField.promptWritingStyle', { genre: config.genre || '未指定', audience: config.targetAudience || '未指定' }),
    }

    return t('generateField.promptHeader', { context }) + '\n\n' + fieldPrompts[this.fieldKey] + t('generateField.promptOutputRequirements')
  }
}
