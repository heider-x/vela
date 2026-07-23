/**
 * read_blueprint — 读取章节蓝图
 */
import i18n from '../../../i18n'
import { buildAgentTool } from '../tool-registry'
import { ipc } from '../../ipc-client'
import { useProjectStore } from '../../../stores/project-store'

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, { ns: 'panels', ...opts })

export const readBlueprintTool = buildAgentTool({
  name: 'read_blueprint',
  description: t('agent.tools.readBlueprint.desc'),
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      chapter_number: {
        type: 'number',
        description: t('agent.tools.readBlueprint.chapterNumberDesc'),
      },
    },
  },
  requiresConfirmation: false,
  execute: async (args) => {
    const project = useProjectStore.getState().currentProject
    if (!project) {
      return { success: false, content: '', error: t('agent.tools.noProject') }
    }

    const chapterNum = args.chapter_number as number | undefined

    if (chapterNum !== undefined) {
      // 读取指定章节蓝图
      const bp = await ipc.invoke('db:blueprint-get', chapterNum)
      if (!bp) {
        return { success: false, content: '', error: t('agent.tools.readBlueprint.notFound', { chapter: chapterNum }) }
      }
      return { success: true, content: `${t('agent.tools.readBlueprint.title', { chapter: chapterNum })}\n\n${t('agent.tools.readBlueprint.labels.title')}: ${bp.title}\n${t('agent.tools.readBlueprint.labels.role')}: ${bp.role}\n${t('agent.tools.readBlueprint.labels.purpose')}: ${bp.purpose}\n${t('agent.tools.readBlueprint.labels.keyEvents')}: ${bp.keyEvents}\n${t('agent.tools.readBlueprint.labels.characters')}: ${bp.characters.join(', ')}\n${t('agent.tools.readBlueprint.labels.suspense')}: ${bp.suspenseHook}\n${t('agent.tools.readBlueprint.labels.notes')}: ${bp.notes}\n${t('agent.tools.readBlueprint.labels.guidance')}: ${bp.userGuidance}` }
    }

    // 列出所有蓝图文件
    try {
      const bps = await ipc.invoke('db:blueprint-get-all')
      if (!bps || bps.length === 0) {
        return { success: true, content: t('agent.tools.readBlueprint.empty') }
      }

      const list = bps.map((b: unknown) => `  - 第 ${(b as { chapterNumber?: number }).chapterNumber} 章: ${(b as { title?: string }).title || t('agent.tools.readBlueprint.noTitle')}`).join('\n')
      return { success: true, content: `${t('agent.tools.readBlueprint.listTitle', { count: bps.length })}\n${list}\n\n${t('agent.tools.readBlueprint.listHint')}` }
    } catch (error) {
      return { success: false, content: '', error: t('agent.tools.readBlueprint.readFailed', { error: String(error) }) }
    }
  },
})
