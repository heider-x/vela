/**
 * list_chapters — 列出所有章节状态概览
 */
import i18n from '../../../i18n'
import { buildAgentTool } from '../tool-registry'
import { ipc } from '../../ipc-client'
import { useProjectStore } from '../../../stores/project-store'

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, { ns: 'panels', ...opts })


export const listChaptersTool = buildAgentTool({
  name: 'list_chapters',
  description: t('agent.tools.listChapters.desc'),
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  requiresConfirmation: false,
  execute: async () => {
    const project = useProjectStore.getState().currentProject
    if (!project) {
      return { success: false, content: '', error: t('agent.tools.noProject') }
    }

    try {
      const blueprints = await ipc.invoke('db:blueprint-get-all')
      const bpNums = new Set<number>((Array.isArray(blueprints) ? blueprints : []).map((b: unknown) => (b as { chapterNumber?: number }).chapterNumber).filter((n): n is number => n !== undefined))
      const { useDraftStore } = await import('../../../stores/draft-store')
      const draftsByChapter = useDraftStore.getState().draftsByChapter
      const draftNums = new Set<number>(Object.keys(draftsByChapter).map(k => parseInt(k, 10)))

      // 定稿状态从 DB 查询而非 FS 扫描
      const msNums = new Set<number>()
      for (const bp of (Array.isArray(blueprints) ? blueprints : [])) {
        const finalized = await ipc.invoke('db:draft-get-finalized', bp.chapterNumber)
        if (finalized) msNums.add(bp.chapterNumber)
      }

      // 合并所有出现过的章节号
      const allNums = new Set([...bpNums, ...draftNums, ...msNums])
      if (allNums.size === 0) {
        return { success: true, content: t('agent.tools.listChapters.noData') }
      }

      const sortedNums = Array.from(allNums).sort((a, b) => a - b)

      const rows = sortedNums.map(num => {
        const hasBp = bpNums.has(num) ? '✅' : '❌'
        const hasDraft = draftNums.has(num) ? '✅' : '❌'
        const hasMs = msNums.has(num) ? '✅' : '❌'
        return `| ${num} | ${hasBp} | ${hasDraft} | ${hasMs} |`
      })

      const table = `${t('agent.tools.listChapters.tableHeader')}\n| --- | --- | --- | --- |\n${rows.join('\n')}`

      return {
        success: true,
        content: `${t('agent.tools.listChapters.summary')}\n\n${table}\n\n${t('agent.tools.listChapters.summaryDetail', { total: sortedNums.length, blueprints: bpNums.size, drafts: draftNums.size, finalized: msNums.size })}`,
      }
    } catch (e: unknown) {
      return { success: false, content: '', error: t('agent.tools.listChapters.getFailed', { error: e instanceof Error ? e.message : String(e) }) }
    }
  },
})
