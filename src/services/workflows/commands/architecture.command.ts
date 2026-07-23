import { BaseWorkflowCommand, CommandExecuteParams } from './base-command'
import { useProjectStore } from '../../../stores/project-store'
import { getPromptTemplate } from '../../prompt-templates'
import { ArchitecturePromptBuilder } from '../../prompts/prompt-builder'
import { ipc } from '../../ipc-client'
import i18n from '../../../i18n'

import type { NovelConfig } from '../../../shared/ipc-channels'

// --- 基础工具库 ---

interface PartialArchData {
  premise_result?: string
  character_dynamics_result?: string
  character_state_result?: string
  world_building_result?: string
  synopsis_result?: string
}

async function loadPartialData(projectPath: string): Promise<PartialArchData> {
  const result = await ipc.invoke('fs:read-json', `${projectPath}/.vela/partial_arch.json`)
  if (result.success && result.data) return result.data as PartialArchData
  return {}
}

async function savePartialData(projectPath: string, data: PartialArchData): Promise<void> {
  await ipc.invoke('fs:write-json', `${projectPath}/.vela/partial_arch.json`, data)
}

function getNovelConfig(): { project: NonNullable<ReturnType<typeof useProjectStore.getState>['currentProject']>; config: NovelConfig } {
  const project = useProjectStore.getState().currentProject
  if (!project) throw new Error(i18n.t('common.noProject', { ns: 'commands' }))
  return { project, config: project.novelConfig }
}

function stripThinkingTags(text: string): string {
  return text.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '').trim()
}

async function writeArchToDb(key: 'premise' | 'charactersArch' | 'worldbuilding' | 'synopsis', content: string): Promise<void> {
  const cleanContent = stripThinkingTags(content)
  await ipc.invoke('db:project-core-update', { [key]: cleanContent })

  // 通知 UI 层实时刷新架构完成状态
  const { globalEventBus } = await import('../../../shared/event-bus')
  globalEventBus.emit('ARCH_FILE_UPDATED', { fileName: `${key}.md` })
}

// --- 独立命令类 ---

export class GenerateConfigCommand extends BaseWorkflowCommand<string> {
  constructor(private idea: string, private totalChapters: number, private wordsPerChapter: number, private onGenerated: (config: Partial<NovelConfig>) => void) {
    super()
  }

  async execute({ callbacks }: CommandExecuteParams): Promise<string> {
    callbacks.log(i18n.t('architecture.dispatchingAI', { ns: 'commands' }))

    const template = getPromptTemplate('generate_global_config')
    if (!template) throw new Error(i18n.t('common.templateNotFound', { ns: 'commands', key: 'generate_global_config' }))

    const promptBuilder = new ArchitecturePromptBuilder(template)
      .withUserIdea(this.idea)
      .withNumberOfChapters(this.totalChapters)
      .withWordNumber(this.wordsPerChapter)

    const resultRaw = await this.callLLMWithBuilder(
      promptBuilder,
      callbacks,
      { responseFormat: { type: 'json_object' }, thinking: true }
    )

    callbacks.log(i18n.t('architecture.parsingComplete', { ns: 'commands' }))
    try {
      const parsed = this.parseJSON<Partial<NovelConfig>>(resultRaw)

      // 防御：LLM 常常将长文本字段错误地生成为对象或数组
      const stringifyField = (val: unknown) => {
        if (!val) return ''
        if (typeof val === 'string') return val
        if (Array.isArray(val)) return val.join('\n')
        if (typeof val === 'object') return JSON.stringify(val, null, 2)
        return String(val)
      }

      if (parsed.coreOutline !== undefined) parsed.coreOutline = stringifyField(parsed.coreOutline)
      if (parsed.worldSetting !== undefined) parsed.worldSetting = stringifyField(parsed.worldSetting)
      if (parsed.goldenFinger !== undefined) parsed.goldenFinger = stringifyField(parsed.goldenFinger)
      if (parsed.protagonistProfile !== undefined) parsed.protagonistProfile = stringifyField(parsed.protagonistProfile)
      if (parsed.globalGuidance !== undefined) parsed.globalGuidance = stringifyField(parsed.globalGuidance)
      if (parsed.referenceWorks !== undefined) parsed.referenceWorks = stringifyField(parsed.referenceWorks)
      if (parsed.writingStyle !== undefined) parsed.writingStyle = stringifyField(parsed.writingStyle)

      if (parsed.totalChapters !== undefined) parsed.totalChapters = parseInt(String(parsed.totalChapters)) || 100
      if (parsed.wordsPerChapter !== undefined) parsed.wordsPerChapter = parseInt(String(parsed.wordsPerChapter)) || 3000

      this.onGenerated(parsed)
      const saved = await useProjectStore.getState().saveProject()

      if (saved) {
        callbacks.log(i18n.t('architecture.configSavedCheckGenerate', { ns: 'commands' }))
      } else {
        callbacks.log(i18n.t('architecture.configSavedClickSave', { ns: 'commands' }))
      }
    } catch (e) {
      throw new Error(i18n.t('architecture.configJsonParseError', { ns: 'commands', detail: String(e) }))
    }
    callbacks.setProgress(100)
    return i18n.t('architecture.configAppliedSuccess', { ns: 'commands' })
  }
}

export class GenerateCoreSeedCommand extends BaseWorkflowCommand<string> {
  async execute({ context, callbacks }: CommandExecuteParams): Promise<string> {
    const { project, config } = getNovelConfig()
    callbacks.log(i18n.t('architecture.generatingPremise', { ns: 'commands' }))

    const template = getPromptTemplate('premise')
    if (!template) throw new Error(i18n.t('common.templateNotFound', { ns: 'commands', key: 'premise' }))

    const promptBuilder = new ArchitecturePromptBuilder(template)
      .withGenre(config.genre)
      .withSubGenre(config.subGenre || config.genre)
      .withTopic(config.coreOutline || i18n.t('architecture.unfilled', { ns: 'commands' }))
      .withTargetAudience(config.targetAudience)
      .withNumberOfChapters(config.totalChapters)
      .withWordNumber(config.wordsPerChapter)
      .withCoreSetting(config.worldSetting || i18n.t('architecture.unfilled', { ns: 'commands' }))
      .withGoldenFinger(config.goldenFinger || i18n.t('architecture.unfilled', { ns: 'commands' }))
      .withProtagonistProfile(config.protagonistProfile || i18n.t('architecture.unfilled', { ns: 'commands' }))
      .withGlobalGuidance(config.globalGuidance || i18n.t('architecture.unfilled', { ns: 'commands' }))
      .withStepGuidance(((context.data.stepGuidance as Record<string, string>) || {}).premise || '')
      .withReferenceWorks(config.referenceWorks || '')

    const result = await this.callLLMWithBuilder(promptBuilder, callbacks, undefined, context)
    if (!result.trim()) throw new Error(i18n.t('architecture.premiseGenerationFailed', { ns: 'commands' }))
    if (context.cancelled) throw new Error(i18n.t('base.workflowCancelled', { ns: 'commands' }))

    const content = `# 故事前提\n\n${result}\n`
    await writeArchToDb('premise', content)

    const partial = (context.data.partial as PartialArchData) || await loadPartialData(project.path)
    partial.premise_result = result
    await savePartialData(project.path, partial)
    context.data.partial = partial

    callbacks.log(i18n.t('architecture.premiseSaved', { ns: 'commands' }))
    return result
  }
}

export class GenerateCharactersCommand extends BaseWorkflowCommand<string> {
  async execute({ context, callbacks }: CommandExecuteParams): Promise<string> {
    const { project, config } = getNovelConfig()

    const core = await ipc.invoke('db:project-core-get')
    const premise_result = core?.premise || ''

    if (!premise_result || premise_result.includes('待生成') || premise_result.length < 50) {
      throw new Error(i18n.t('architecture.premiseNotReady', { ns: 'commands' }))
    }

    callbacks.log(i18n.t('architecture.generatingCharacters', { ns: 'commands' }))
    const template = getPromptTemplate('character_dynamics')
    if (!template) throw new Error(i18n.t('common.templateNotFound', { ns: 'commands', key: 'character_dynamics' }))

    const promptBuilder = new ArchitecturePromptBuilder(template)
      .withCoreSeed(premise_result)
      .withGenre(config.genre)
      .withProtagonistProfile(config.protagonistProfile || i18n.t('architecture.unfilled', { ns: 'commands' }))
      .withGoldenFinger(config.goldenFinger || i18n.t('architecture.unfilled', { ns: 'commands' }))
      .withWorldBuilding(config.worldSetting || i18n.t('architecture.unfilled', { ns: 'commands' }))
      .withNumberOfChapters(config.totalChapters)
      .withGlobalGuidance(config.globalGuidance || i18n.t('architecture.unfilled', { ns: 'commands' }))
      .withStepGuidance(((context.data.stepGuidance as Record<string, string>) || {}).characters || '')
      .withReferenceWorks(config.referenceWorks || '')

    const result = await this.callLLMWithBuilder(promptBuilder, callbacks, undefined, context)
    if (!result.trim()) throw new Error(i18n.t('architecture.charactersGenerationFailed', { ns: 'commands' }))
    if (context.cancelled) throw new Error(i18n.t('base.workflowCancelled', { ns: 'commands' }))

    await writeArchToDb('charactersArch', `# 角色图谱\n\n${result}\n`)

    callbacks.log(i18n.t('architecture.extractingCharacterCards', { ns: 'commands' }))
    const { runArchCharacterExtract } = await import('../architecture-workflow')
    runArchCharacterExtract(project.path, result, config.genre)

    const partial = (context.data.partial as PartialArchData) || await loadPartialData(project.path)
    partial.character_dynamics_result = result
    await savePartialData(project.path, partial)
    context.data.partial = partial

    callbacks.log(i18n.t('architecture.charactersSaved', { ns: 'commands' }))
    return result
  }
}

export class GenerateWorldBuildingCommand extends BaseWorkflowCommand<string> {
  async execute({ context, callbacks }: CommandExecuteParams): Promise<string> {
    const { project, config } = getNovelConfig()

    const core = await ipc.invoke('db:project-core-get')
    const premise_result = core?.premise || ''

    if (!premise_result || premise_result.includes('待生成') || premise_result.length < 50) {
      throw new Error(i18n.t('architecture.premiseNotReady', { ns: 'commands' }))
    }

    callbacks.log(i18n.t('architecture.generatingWorldbuilding', { ns: 'commands' }))
    const template = getPromptTemplate('world_building')
    if (!template) throw new Error(i18n.t('common.templateMissing', { ns: 'commands' }))

    const promptBuilder = new ArchitecturePromptBuilder(template)
      .withCoreSeed(premise_result)
      .withGenre(config.genre)
      .withCoreSetting(config.worldSetting || i18n.t('architecture.unfilled', { ns: 'commands' }))
      .withGoldenFinger(config.goldenFinger || i18n.t('architecture.unfilled', { ns: 'commands' }))
      .withProtagonistProfile(config.protagonistProfile || i18n.t('architecture.unfilled', { ns: 'commands' }))
      .withGlobalGuidance(config.globalGuidance || i18n.t('architecture.unfilled', { ns: 'commands' }))
      .withStepGuidance(((context.data.stepGuidance as Record<string, string>) || {}).worldbuilding || '')

    const result = await this.callLLMWithBuilder(promptBuilder, callbacks, undefined, context)
    if (context.cancelled) throw new Error(i18n.t('base.workflowCancelled', { ns: 'commands' }))

    await writeArchToDb('worldbuilding', `# 世界观\n\n${result}\n`)

    const partial = (context.data.partial as PartialArchData) || await loadPartialData(project.path)
    partial.world_building_result = result
    await savePartialData(project.path, partial)
    context.data.partial = partial

    callbacks.log(i18n.t('architecture.worldbuildingSaved', { ns: 'commands' }))
    return result
  }
}

export class GeneratePlotArchitectureCommand extends BaseWorkflowCommand<string> {
  constructor(private selectedSteps: string[]) {
    super()
  }

  async execute({ context, callbacks }: CommandExecuteParams): Promise<string> {
    const { project, config } = getNovelConfig()

    const core = await ipc.invoke('db:project-core-get')
    const premise = core?.premise || ''
    const char_dyn = core?.charactersArch || ''
    const world_b = core?.worldbuilding || ''

    if (!premise || premise.includes('待生成')) throw new Error(i18n.t('architecture.premiseNotGenerated', { ns: 'commands' }))
    if (!char_dyn || char_dyn.includes('待生成')) throw new Error(i18n.t('architecture.charactersNotGenerated', { ns: 'commands' }))
    if (!world_b || world_b.includes('待生成')) throw new Error(i18n.t('architecture.worldbuildingNotGenerated', { ns: 'commands' }))

    callbacks.log(i18n.t('architecture.generatingSynopsis', { ns: 'commands' }))
    const template = getPromptTemplate('synopsis')
    if (!template) throw new Error(i18n.t('common.templateMissing', { ns: 'commands' }))

    const { getPlotStructureGuide, getNarrativePOVLabel } = await import('../architecture-workflow')
    const guide = getPlotStructureGuide(config.plotStructure || 'three_act', config.totalChapters)
    const pov = getNarrativePOVLabel(config.narrativePOV || 'third_limited')

    const promptBuilder = new ArchitecturePromptBuilder(template)
      .withCoreSeed(premise)
      .withCharacterDynamics(char_dyn)
      .withWorldBuilding(world_b)
      .withGenre(config.genre)
      .withNumberOfChapters(config.totalChapters)
      .withWordNumber(config.wordsPerChapter)
      .withPlotStructureGuide(guide)
      .withNarrativePov(pov)
      .withGlobalGuidance(config.globalGuidance || i18n.t('architecture.unfilled', { ns: 'commands' }))
      .withStepGuidance(((context.data.stepGuidance as Record<string, string>) || {}).synopsis || '')

    const result = await this.callLLMWithBuilder(promptBuilder, callbacks, undefined, context)
    if (context.cancelled) throw new Error(i18n.t('base.workflowCancelled', { ns: 'commands' }))

    await writeArchToDb('synopsis', `# 情节大纲\n\n${result}\n`)

    const partial = (context.data.partial as PartialArchData) || await loadPartialData(project.path)
    partial.synopsis_result = result
    context.data.partial = partial

    if (this.selectedSteps.includes('premise') && this.selectedSteps.includes('characters') &&
      this.selectedSteps.includes('worldbuilding') && this.selectedSteps.includes('synopsis')) {
      await ipc.invoke('fs:write-file', `${project.path}/.vela/partial_arch.json`, '{}')
    }

    callbacks.log(i18n.t('architecture.synopsisSaved', { ns: 'commands' }))
    return result
  }
}
