/**
 * read_characters — 读取角色卡档案
 */
import i18n from '../../../i18n'
import { buildAgentTool } from '../tool-registry'
import { ipc } from '../../ipc-client'
import { useProjectStore } from '../../../stores/project-store'

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, { ns: 'panels', ...opts })

export const readCharactersTool = buildAgentTool({
  name: 'read_characters',
  description: t('agent.tools.readCharacters.desc'),
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      character_name: {
        type: 'string',
        description: t('agent.tools.readCharacters.characterNameDesc'),
      },
    },
  },
  requiresConfirmation: false,
  execute: async (args) => {
    const project = useProjectStore.getState().currentProject
    if (!project) {
      return { success: false, content: '', error: t('agent.tools.noProject') }
    }

    const charName = args.character_name as string | undefined

    try {
      const charsResult = await ipc.invoke('db:character-get-all')
      const chars = (Array.isArray(charsResult) ? charsResult : []) as unknown as Array<Record<string, unknown>>
      if (!chars || chars.length === 0) {
        return { success: true, content: t('agent.tools.readCharacters.empty') }
      }

      if (charName) {
        // 查找指定角色
        const target = chars.find((c) =>
          String(c.name).toLowerCase().includes(charName.toLowerCase())
        )
        if (!target) {
          const available = chars.map((c) => String(c.name)).join('、')
          return { success: false, content: '', error: t('agent.tools.readCharacters.notFound', { name: charName, available }) }
        }

        const formatted = Object.entries(target)
          .filter(([k, v]) => v && k !== 'id')
          .map(([k, v]) => `**${k}**: ${typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v)}`)
          .join('\n')
        return { success: true, content: `${t('agent.tools.readCharacters.cardTitle', { name: target.name })}\n\n${formatted}` }
      }

      // 列出所有角色
      const list = chars.map((c) => `  - ${c.name} (${c.role})`).join('\n')
      return { success: true, content: `${t('agent.tools.readCharacters.listTitle', { count: chars.length })}\n${list}\n\n${t('agent.tools.readCharacters.listHint')}` }
    } catch (error) {
      return { success: false, content: '', error: t('agent.tools.readCharacters.readFailed', { error: String(error) }) }
    }
  },
})
