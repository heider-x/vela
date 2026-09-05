/**
 * update_config — 更新小说配置
 */
import i18n from '../../../i18n'
import { buildAgentTool } from '../tool-registry'
import { ipc } from '../../ipc-client'
import { useProjectStore } from '../../../stores/project-store'
import { applyRevision, assertStoryProject } from '../story-revision-service'
import type { NovelConfig } from '../../../shared/ipc-channels'
import type { StoryReadResult } from '../../../shared/story-revision'

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, { ns: 'panels', ...opts })

export const updateConfigTool = buildAgentTool({
  name: 'update_config',
  description: t('agent.tools.updateConfig.desc'),
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      field: {
        type: 'string',
        description: t('agent.tools.updateConfig.fieldDesc'),
        enum: ['genre', 'subGenre', 'targetAudience', 'totalChapters', 'wordsPerChapter',
               'coreOutline', 'worldSetting', 'goldenFinger', 'protagonistProfile',
               'globalGuidance', 'writingStyle', 'narrativePOV', 'referenceWorks'],
      },
      value: {
        type: 'string',
        description: t('agent.tools.updateConfig.valueDesc'),
      },
    },
    required: ['field', 'value'],
  },
  requiresConfirmation: false,
  isReadOnly: false,
  execute: async (args, context) => {
    const field = args.field as string
    const value = args.value as string

    if (!field || value === undefined) {
      return { success: false, content: '', error: t('agent.tools.updateConfig.missingParams') }
    }

    const project = useProjectStore.getState().currentProject
    if (!project) {
      return { success: false, content: '', error: t('agent.tools.noProject') }
    }

    // Narrative settings use the same versioned journal as linked story changes.
    const contentFields: Record<string, string> = { genre: 'genre', subGenre: 'subGenre', coreOutline: 'synopsis', worldSetting: 'worldbuilding', goldenFinger: 'goldenFinger', protagonistProfile: 'charactersArch', globalGuidance: 'globalGuidance', writingStyle: 'writingStyle', narrativePOV: 'narrativePov' }
    if (contentFields[field]) {
      const fieldName = contentFields[field]
      const chunks: string[] = []
      let offset: number | null = 0, version = ''
      do {
        const doc: StoryReadResult = await ipc.invoke('story:read', project.path, { kind: 'core', id: 'main', field: fieldName, offset })
        assertStoryProject(project.path)
        if (version && doc.version !== version) throw new Error('配置读取期间已有更新，请重新读取。')
        version = doc.version; chunks.push(doc.content ?? ''); offset = doc.nextOffset ?? null
      } while (offset !== null)
      const before = chunks.join('')
      if (before === value) return { success: true, content: '已保存的配置与要求一致，无需重复修改。' }
      const revision = await applyRevision(project.path, { intent: '按作者要求更新小说配置', summary: '更新小说配置，正文是否需要调整应另行逐章检查。', edits: [{ kind: 'core', id: 'main', field: fieldName, version, oldText: before, newText: value }] }, context?.signal)
      return { success: true, content: '配置已保存并同步；正文尚需单独核对和修改。', artifacts: [{ type: 'story_revision', path: project.path, name: revision.intent, revisionId: revision.id }] }
    }
    if (!['targetAudience', 'totalChapters', 'wordsPerChapter', 'referenceWorks'].includes(field)) return { success: false, content: '', error: '不支持该配置项。' }
    const actualValue = ['totalChapters', 'wordsPerChapter'].includes(field) ? Number(value) : value
    if (typeof actualValue === 'number' && (!Number.isSafeInteger(actualValue) || actualValue <= 0)) return { success: false, content: '', error: '章节数和字数必须是正整数。' }
    assertStoryProject(project.path)
    if (context?.signal?.aborted) throw new Error('操作已取消。')

    // 构造更新数据
    const updateData = {
      novelConfig: { ...project.novelConfig, [field]: actualValue },
    }

    const result = await ipc.invoke('project:update-config', project.id, updateData)
    if (!result.success) {
      return { success: false, content: '', error: result.error ?? t('agent.tools.updateConfig.updateFailed') }
    }
    if (useProjectStore.getState().currentProject?.path === project.path) useProjectStore.getState().updateNovelConfig({ [field]: actualValue } as Partial<NovelConfig>)

    return {
      success: true,
      content: t('agent.tools.updateConfig.updated', { field, value: typeof value === 'string' && value.length > 50 ? value.slice(0, 50) + '…' : value }),
    }
  },
})
