/**
 * read_project_state — 读取项目全局状态
 */
import i18n from '../../../i18n'
import { buildAgentTool } from '../tool-registry'
import { useProjectStore } from '../../../stores/project-store'
import { ipc } from '../../ipc-client'

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, { ns: 'panels', ...opts })

export const readProjectStateTool = buildAgentTool({
  name: 'read_project_state',
  description: t('agent.tools.readProjectState.desc'),
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      include_config: {
        type: 'boolean',
        description: t('agent.tools.readProjectState.includeConfigDesc'),
        default: true,
      },
      include_summary: {
        type: 'boolean',
        description: t('agent.tools.readProjectState.includeSummaryDesc'),
        default: true,
      },
    },
  },
  requiresConfirmation: false,
  execute: async (args) => {
    const project = useProjectStore.getState().currentProject
    if (!project) {
      return { success: false, content: '', error: t('agent.tools.noProject') }
    }

    const includeConfig = (args.include_config as boolean) !== false
    const includeSummary = (args.include_summary as boolean) !== false

    const parts: string[] = [`${t('agent.tools.readProjectState.projectStatus', { name: project.name })}\n`]

    if (includeConfig) {
      // 读取小说配置
      try {
        const core = await ipc.invoke('db:project-core-get')
        if (core) {
          parts.push(`${t('agent.tools.readProjectState.novelConfig')}\n\`\`\`json\n${JSON.stringify({
            projectName: core.projectName,
            genre: core.genre,
            subGenre: core.subGenre,
            targetAudience: core.targetAudience,
            totalChapters: core.totalChapters,
            wordsPerChapter: core.wordsPerChapter,
            plotStructure: core.plotStructure,
            narrativePov: core.narrativePov,
            writingStyle: core.writingStyle
          }, null, 2)}\n\`\`\``)
        }
      } catch {
        // Fallback
        parts.push(`${t('agent.tools.readProjectState.novelConfig')}\n${t('agent.tools.readProjectState.configFailed')}`)
      }
    }

    if (includeSummary) {
      // 读取最近 5 章蓝图的 notes 字段作为进度摘要
      const notesParts: string[] = []
      try {
        const bps = await ipc.invoke('db:blueprint-get-all')
        if (bps && Array.isArray(bps)) {
          // 倒序遍历
          const sorted = bps.sort((a, b) => b.chapterNumber - a.chapterNumber)
          for (const bp of sorted) {
            if (bp.notes && bp.notes.trim()) {
              notesParts.unshift(t('agent.tools.readProjectState.chapterHeading', { chapter: bp.chapterNumber, title: bp.title || '' }) + `\n${bp.notes}`)
              if (notesParts.length >= 5) break
            }
          }
        }
      } catch { /* 忽略 */ }

      if (notesParts.length > 0) {
        parts.push(`${t('agent.tools.readProjectState.chapterSummary')}\n${notesParts.join('\n\n')}`)
      } else {
        parts.push(`${t('agent.tools.readProjectState.chapterSummary')}\n${t('agent.tools.readProjectState.noSummary')}`)
      }
    }

    return { success: true, content: parts.join('\n\n') }
  },
})

