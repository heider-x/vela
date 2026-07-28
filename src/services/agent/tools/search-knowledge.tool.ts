/**
 * search_knowledge — 语义搜索知识库
 */
import i18n from '../../../i18n'
import { buildAgentTool } from '../tool-registry'
import { ipc } from '../../ipc-client'

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, { ns: 'panels', ...opts })

export const searchKnowledgeTool = buildAgentTool({
  name: 'search_knowledge',
  description: t('agent.tools.searchKnowledge.desc'),
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: t('agent.tools.searchKnowledge.queryDesc'),
      },
      top_k: {
        type: 'number',
        description: t('agent.tools.searchKnowledge.topKDesc'),
        default: 5,
      },
    },
    required: ['query'],
  },
  requiresConfirmation: false,
  execute: async (args) => {
    const query = args.query as string
    const topK = (args.top_k as number) ?? 5

    if (!query) {
      return { success: false, content: '', error: t('agent.tools.searchKnowledge.missingQuery') }
    }

    const results = await ipc.invoke('kb:search', query, topK)
    if (!results || results.length === 0) {
      return { success: true, content: t('agent.tools.searchKnowledge.noResults') }
    }

    const formatted = results.map((r, i) =>
      `### ${t('agent.tools.searchKnowledge.resultTitle', { number: i + 1 })} (${t('agent.tools.searchKnowledge.similarity')}: ${r.score.toFixed(2)})\n${t('agent.tools.searchKnowledge.source')}: ${r.fileName}\n\n${r.text}`
    ).join('\n\n---\n\n')

    return { success: true, content: `${t('agent.tools.searchKnowledge.foundCount', { count: results.length })}\n\n${formatted}` }
  },
})
