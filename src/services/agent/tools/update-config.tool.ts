/**
 * update_config — 更新小说配置
 */
import i18n from '../../../i18n'
import { buildAgentTool } from '../tool-registry'
import { ipc } from '../../ipc-client'
import { useProjectStore } from '../../../stores/project-store'

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
               'globalGuidance', 'writingStyle', 'referenceWorks'],
      },
      value: {
        type: 'string',
        description: t('agent.tools.updateConfig.valueDesc'),
      },
    },
    required: ['field', 'value'],
  },
  requiresConfirmation: true,
  isReadOnly: false,
  execute: async (args) => {
    const field = args.field as string
    const value = args.value as string

    if (!field || value === undefined) {
      return { success: false, content: '', error: t('agent.tools.updateConfig.missingParams') }
    }

    const project = useProjectStore.getState().currentProject
    if (!project) {
      return { success: false, content: '', error: t('agent.tools.noProject') }
    }

    // 构造更新数据
    const updateData = {
      novelConfig: { ...project.novelConfig, [field]: value },
    }

    const result = await ipc.invoke('project:update-config', project.id, updateData)
    if (!result.success) {
      return { success: false, content: '', error: result.error ?? t('agent.tools.updateConfig.updateFailed') }
    }

    return {
      success: true,
      content: t('agent.tools.updateConfig.updated', { field, value: typeof value === 'string' && value.length > 50 ? value.slice(0, 50) + '…' : value }),
    }
  },
})
