import type { WorkflowDefinition, WorkflowContext, StepCallbacks } from '../../stores/workflow-store'
import { useLLMStore } from '../../stores/llm-store'
import { useProjectStore } from '../../stores/project-store'
import { getPromptTemplate } from '../prompt-templates'
import { ipc } from '../ipc-client'
import type { NovelConfig } from '../../shared/ipc-channels'
import type { CharacterData } from '../../../electron/repositories/character-repository'
import i18n from '../../i18n'

import { runPostProcessPipeline, type PostProcessStep, stripThinkingTags } from './workflow-utils'

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, { ns: 'commands', ...opts })

// ==========================================
// 1. 类型定义
// ==========================================

export interface PartialArchData {
  premise_result?: string
  character_dynamics_result?: string
  character_state_result?: string
  world_building_result?: string
  synopsis_result?: string
}

export interface ArchitectureWorkflowParams {
  selectedSteps?: Array<'premise' | 'characters' | 'worldbuilding' | 'synopsis'>
  /** 每步的补充指导（如 { premise: "多强调金手指的限制" }） */
  stepGuidance?: Record<string, string>
}

export interface ConfigGenerationWorkflowParams {
  idea: string
  totalChapters: number
  wordsPerChapter: number
  onGenerated: (config: Partial<NovelConfig>) => void
}

// ==========================================
// 2. 工作流定义
// ==========================================

export function createArchitectureWorkflow(params: ArchitectureWorkflowParams = {}): WorkflowDefinition {
  const sel = params.selectedSteps ?? ['premise', 'characters', 'worldbuilding', 'synopsis']
  const stepDesc = (key: string, defaultKey: string) => sel.includes(key as never) ? t(defaultKey) : t('workflowDefs.stepSkipDesc')
  // 闭包捕获逐步指导，executor 中注入到 context.data
  const guidance = params.stepGuidance || {}

  const allSteps = [
    {
      name: t('workflowDefs.stepPremise'),
      key: 'premise',
      description: stepDesc('premise', 'workflowDefs.stepPremiseDesc'),
      executor: async (step: unknown, context: WorkflowContext, callbacks: StepCallbacks) => {
        context.data.stepGuidance = guidance
        const { GenerateCoreSeedCommand } = await import('./commands/architecture.command')
        return new GenerateCoreSeedCommand().execute({ step, context, callbacks })
      },
    },
    {
      name: t('workflowDefs.stepCharacters'),
      key: 'characters',
      description: stepDesc('characters', 'workflowDefs.stepCharactersDesc'),
      executor: async (step: unknown, context: WorkflowContext, callbacks: StepCallbacks) => {
        context.data.stepGuidance = guidance
        const { GenerateCharactersCommand } = await import('./commands/architecture.command')
        return new GenerateCharactersCommand().execute({ step, context, callbacks })
      },
    },
    {
      name: t('workflowDefs.stepWorldbuilding'),
      key: 'worldbuilding',
      description: stepDesc('worldbuilding', 'workflowDefs.stepWorldbuildingDesc'),
      executor: async (step: unknown, context: WorkflowContext, callbacks: StepCallbacks) => {
        context.data.stepGuidance = guidance
        const { GenerateWorldBuildingCommand } = await import('./commands/architecture.command')
        return new GenerateWorldBuildingCommand().execute({ step, context, callbacks })
      },
    },
    {
      name: t('workflowDefs.stepSynopsis'),
      key: 'synopsis',
      description: stepDesc('synopsis', 'workflowDefs.stepSynopsisDesc'),
      executor: async (step: unknown, context: WorkflowContext, callbacks: StepCallbacks) => {
        context.data.stepGuidance = guidance
        const { GeneratePlotArchitectureCommand } = await import('./commands/architecture.command')
        return new GeneratePlotArchitectureCommand(sel).execute({ step, context, callbacks })
      },
    },
  ]

  const finalSteps = allSteps.filter(s => sel.includes(s.key as never))

  return {
    type: 'architecture_generation',
    title: t('workflowDefs.architectureTitle'),
    steps: finalSteps,
    onComplete: { mode: 'silent', message: t('workflowDefs.architectureCompletedMessage') },
  }
}

export function createConfigGenerationWorkflow(params: ConfigGenerationWorkflowParams): WorkflowDefinition {
  return {
    type: 'config_generation',
    title: t('workflowDefs.configGenTitle'),
    steps: [
      {
        name: t('workflowDefs.configGenStepName'),
        description: t('workflowDefs.configGenStepDesc', { chapters: params.totalChapters }),
        executor: async (step, context, callbacks) => {
          const { GenerateConfigCommand } = await import('./commands/architecture.command')
          const cmd = new GenerateConfigCommand(params.idea, params.totalChapters, params.wordsPerChapter, params.onGenerated)
          return cmd.execute({ step, context, callbacks })
        },
      },
    ],
    onComplete: { mode: 'silent', message: t('workflowDefs.configGenCompleted') },
  }
}

// ==========================================
// 3. 工具与指导文本
// ==========================================

export function getPlotStructureGuide(structure: string, totalChapters: number): string {
  const ch20 = Math.round(totalChapters * 0.2)
  const ch25 = Math.round(totalChapters * 0.25)
  const ch50 = Math.round(totalChapters * 0.5)
  const ch75 = Math.round(totalChapters * 0.75)

  switch (structure) {
    case 'heros_journey':
      return t('workflowDefs.guideHerosJourney', { total: totalChapters })
    case 'save_the_cat':
      return t('workflowDefs.guideSaveTheCat', { total: totalChapters })
    case 'kishotenketsu':
      return t('workflowDefs.guideKishotenketsu', {
        total: totalChapters, ch25, ch25Next: ch25 + 1,
        ch50, ch50Next: ch50 + 1, ch75, ch75Next: ch75 + 1,
      })
    case 'multi_thread':
      return t('workflowDefs.guideMultiThread', { total: totalChapters, ch25, ch50, ch75 })
    case 'freeform':
      return t('workflowDefs.guideFreeform', { total: totalChapters })
    case 'three_act':
    default:
      return t('workflowDefs.guideThreeAct', {
        total: totalChapters, ch20, ch20Next: ch20 + 1,
        ch75, ch75Next: ch75 + 1,
      })
  }
}

export function getNarrativePOVLabel(pov: string): string {
  const labels: Record<string, string> = {
    first_person: t('workflowDefs.povFirstPerson'),
    third_limited: t('workflowDefs.povThirdLimited'),
    third_omniscient: t('workflowDefs.povThirdOmniscient'),
    multi_pov: t('workflowDefs.povMultiPov'),
  }
  return labels[pov] || pov
}

// ==========================================
// 4. 角色卡后处理逻辑
// ==========================================

export const ARCH_CHARACTER_SCOPE = 'arch_characters'

export function createCharacterExtractSteps(_projectPath: string, characterDynamicsContent: string, genre: string): PostProcessStep[] {
  return [
    {
      key: 'extract_character_cards',
      label: t('workflowDefs.charExtractLabel'),
      critical: true,
      executor: async (cb) => {
        const { ArchitecturePromptBuilder } = await import('../prompts/prompt-builder')
        const template = getPromptTemplate('extract_initial_characters')
        if (!template) throw new Error(t('common.templateNotFound', { key: 'extract_initial_characters' }))
        const extractPrompt = new ArchitecturePromptBuilder(template).withCharacterDynamics(characterDynamicsContent).withGenre(genre).build()
        const systemRole = template.systemRole || t('workflowDefs.charExtractSystemRole')

        const llmStore = useLLMStore.getState()
        cb.appendText(t('workflowDefs.charExtractingCards') + '\n')

        let fullContent = ''
        await new Promise<void>((resolve, reject) => {
          llmStore.generateStream(
            [
              { role: 'system', content: systemRole },
              { role: 'user', content: extractPrompt }
            ],
            {
              onChunk: (chunk) => { fullContent += chunk; cb.appendText(chunk) },
              onDone: () => resolve(),
              onError: (err) => reject(new Error(err))
            },
            undefined,
            { responseFormat: { type: 'json_object' } }
          )
        })

        const cleanedCards = stripThinkingTags(fullContent)
        const jsonStr = cleanedCards.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
        // 容错解析：AI 输出常含全角标点（：，、“”）、尾逗号、单引号或未加引号的键
        const normalized = jsonStr
          .replace(/[“”]/g, '"')
          .replace(/[‘’]/g, "'")
          .replace(/：/g, ':')
          .replace(/，/g, ',')
          .replace(/,(\s*[}\]])/g, '$1')

        const sliceJson = (s: string, open: string, close: string): string | null => {
          const start = s.indexOf(open)
          const end = s.lastIndexOf(close)
          return start >= 0 && end > start ? s.substring(start, end + 1) : null
        }

        // 依次尝试多种候选：数组区间、对象区间、原文、单引号修正、未加引号键修正
        const candidates = [
          sliceJson(normalized, '[', ']'),
          sliceJson(normalized, '{', '}'),
          normalized,
          normalized.replace(/'/g, '"'),
          normalized.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/g, '$1"$2":')
        ]

        let parsedData: unknown = null
        for (const candidate of candidates) {
          if (!candidate) continue
          try {
            parsedData = JSON.parse(candidate)
            break
          } catch {
            // 尝试下一个候选
          }
        }

        if (parsedData === null) {
          throw new Error(t('workflowDefs.charExtractError', { preview: normalized.slice(0, 500) }))
        }

        // 兼容多种格式：直接数组、{ characters: [...] }、或其他包含数组的对象
        let parsedCards: Array<Record<string, unknown>> = []
        if (Array.isArray(parsedData)) {
          // 直接返回数组 [...]
          parsedCards = parsedData as Array<Record<string, unknown>>
        } else if (parsedData && typeof parsedData === 'object') {
          const obj = parsedData as Record<string, unknown>
          // 优先查找 characters 字段
          if (Array.isArray(obj.characters)) {
            parsedCards = obj.characters as Array<Record<string, unknown>>
          } else {
            // 回退：查找对象中第一个包含对象的数组字段
            for (const value of Object.values(obj)) {
              if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') {
                parsedCards = value as Array<Record<string, unknown>>
                break
              }
            }
          }
        }

        if (parsedCards.length === 0) {
          // 输出原始内容前 500 字符用于调试
          const preview = normalized.slice(0, 500)
          throw new Error(t('workflowDefs.charExtractError', { preview }))
        }

        // 构建角色卡数据列表
        const validRoles = ['protagonist', 'antagonist', 'supporting', 'minor']
        const characterDataList: Array<Record<string, unknown>> = []
        for (const card of parsedCards) {
          if (!card.name) continue
          const role = validRoles.includes(card.role as string) ? card.role : 'supporting'
          characterDataList.push({ ...card, role, name: card.name })
        }

        // 批量写入数据库
        const saveResult = (await ipc.invoke('db:character-save-all', characterDataList as unknown as CharacterData[])) as { success?: boolean; error?: string } | undefined
        if (saveResult && !saveResult.success) {
          throw new Error(`${t('workflowDefs.charExtractSaveFailed')}: ${saveResult.error}`)
        }
        cb.log(t('workflowDefs.charExtractDone', { count: characterDataList.length }))
      },
    },
  ]
}

export function runArchCharacterExtract(projectPath: string, characterDynamicsContent: string, genre: string): void {
  const steps = createCharacterExtractSteps(projectPath, characterDynamicsContent, genre)
  import('../../stores/workflow-store').then(async ({ useWorkflowStore }) => {
    await useWorkflowStore.getState().startWorkflow({
      type: 'post_process',
      title: t('workflowDefs.charExtractTitle'),
      steps: [
        {
          name: t('workflowDefs.charExtractStepName'),
          description: t('workflowDefs.charExtractStepDesc'),
          executor: async (_step, _ctx, callbacks) => {
            const { globalEventBus } = await import('../../shared/event-bus')
            const archStatus = await runPostProcessPipeline(projectPath, ARCH_CHARACTER_SCOPE, t('workflowDefs.sourceLabelArchCharacters'), steps, callbacks)
            if (archStatus.allCriticalPassed) {
              // 角色卡提取成功 → 通过 EventBus 通知 ProjectService 刷新
              globalEventBus.emit('ARCH_POSTPROCESS_UPDATED', {})
            } else {
              globalEventBus.emit('CHARACTER_EXTRACT_FAILED', { error: archStatus.steps.extract_character_cards?.error })
              globalEventBus.emit('ARCH_POSTPROCESS_UPDATED', {})
            }
          },
        },
      ],
    })
  })
}

export async function repairArchCharacterCards(projectPath: string): Promise<void> {
  const core = await ipc.invoke('db:project-core-get')
  if (!core?.charactersArch || core.charactersArch.length < 50) throw new Error(t('workflowDefs.charExtractFailed'))

  const project = useProjectStore.getState().currentProject
  if (!project) throw new Error(t('common.noProject'))

  const steps = createCharacterExtractSteps(projectPath, core.charactersArch, project.novelConfig.genre)
  const { useWorkflowStore } = await import('../../stores/workflow-store')
  await useWorkflowStore.getState().startWorkflow({
    type: 'post_process',
    title: t('workflowDefs.charRepairTitle'),
    steps: [
      {
        name: t('workflowDefs.charRepairStepName'),
        description: t('workflowDefs.charRepairStepDesc'),
        executor: async (_step, _ctx, callbacks) => {
          const { globalEventBus } = await import('../../shared/event-bus')
          const archStatus = await runPostProcessPipeline(projectPath, ARCH_CHARACTER_SCOPE, t('workflowDefs.sourceLabelArchCharacters'), steps, callbacks, { onlyFailed: true })
          if (archStatus.allCriticalPassed) {
            globalEventBus.emit('ARCH_POSTPROCESS_UPDATED', {})
          } else {
            globalEventBus.emit('ARCH_POSTPROCESS_UPDATED', {})
          }
        },
      },
    ],
  })
}

