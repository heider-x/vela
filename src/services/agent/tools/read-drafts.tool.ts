/**
 * read_drafts — 读取草稿内容及状态
 */
import i18n from '../../../i18n'
import { buildAgentTool } from '../tool-registry'
import { ipc } from '../../ipc-client'
import { useProjectStore } from '../../../stores/project-store'

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, { ns: 'panels', ...opts })

export const readDraftsTool = buildAgentTool({
  name: 'read_drafts',
  description: t('agent.tools.readDrafts.desc'),
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      chapter_number: {
        type: 'number',
        description: t('agent.tools.readDrafts.chapterNumberDesc'),
      },
      draft_type: {
        type: 'string',
        description: t('agent.tools.readDrafts.draftTypeDesc'),
        enum: ['draft_v1', 'revised', 'latest'],
        default: 'latest',
      },
    },
    required: ['chapter_number'],
  },
  requiresConfirmation: false,
  execute: async (args) => {
    const project = useProjectStore.getState().currentProject
    if (!project) {
      return { success: false, content: '', error: t('agent.tools.noProject') }
    }

    const chapterNum = args.chapter_number as number
    const draftType = (args.draft_type as string) ?? 'latest'

    try {
      // 从数据库获取章节的草稿列表
      const draftsResult = await ipc.invoke('db:draft-list', chapterNum)
      const drafts = (Array.isArray(draftsResult) ? draftsResult : []) as unknown as Array<Record<string, unknown>>
      if (!drafts || drafts.length === 0) {
        return { success: true, content: t('agent.tools.readDrafts.noDrafts', { chapter: chapterNum }) }
      }

      let targetId: number | null = null
      let targetName = ''

      if (draftType === 'latest') {
        const latest = drafts[0] // 默认查询回来是按 version 倒序排列的
        targetId = latest.id as number
        targetName = `v${latest.version as number}`
      } else {
        // 查找指定类型的草稿
        const target = drafts.find(d => {
          if (draftType === 'draft_v1') return (d.version as number) === 1
          if (draftType === 'revised') return (d.version as number) > 1
          return false
        })

        if (!target) {
          const available = drafts.map(d => `v${d.version as number}`).join('、')
          return { success: false, content: '', error: t('agent.tools.readDrafts.notFound', { type: draftType, available }) }
        }
        targetId = target.id as number
        targetName = `v${target.version as number}`
      }

      const fullDraft = await ipc.invoke('db:draft-get-full', targetId as number) as { content?: string } | null
      if (!fullDraft) {
        return { success: false, content: '', error: t('agent.tools.readDrafts.readContentFailed', { id: targetId }) }
      }
      return { success: true, content: `${t('agent.tools.readDrafts.title', { chapter: chapterNum, version: targetName })}\n\n${fullDraft.content}` }
    } catch (error) {
      return { success: false, content: '', error: t('agent.tools.readDrafts.readFailed', { error: String(error) }) }
    }
  },
})
