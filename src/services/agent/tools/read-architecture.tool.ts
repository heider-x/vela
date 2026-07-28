/**
 * read_architecture — 读取故事架构文件
 */
import i18n from '../../../i18n'
import { buildAgentTool } from '../tool-registry'
import { ipc } from '../../ipc-client'
import { useProjectStore } from '../../../stores/project-store'

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, { ns: 'panels', ...opts })

export const readArchitectureTool = buildAgentTool({
  name: 'read_architecture',
  description: t('agent.tools.readArchitecture.desc'),
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      file_name: {
        type: 'string',
        description: t('agent.tools.readArchitecture.fileNameDesc'),
      },
    },
  },
  requiresConfirmation: false,
  execute: async (args) => {
    const project = useProjectStore.getState().currentProject
    if (!project) {
      return { success: false, content: '', error: t('agent.tools.noProject') }
    }

    const fileName = args.file_name as string | undefined

    try {
      const core = await ipc.invoke('db:project-core-get')
      if (!core) {
        return { success: false, content: '', error: t('agent.tools.readArchitecture.notInitialized') }
      }

      if (fileName) {
        // Find property based on suffix
        const isPremise = fileName.includes('前提') || fileName.includes('premise')
        const isWorld = fileName.includes('世界') || fileName.includes('world')
        const isChar = fileName.includes('角色') || fileName.includes('character')
        const isSynopsis = fileName.includes('大纲') || fileName.includes('synopsis')
        let property = ''
        if (isPremise) property = core.premise
        else if (isWorld) property = core.worldbuilding
        else if (isChar) property = core.charactersArch
        else if (isSynopsis) property = core.synopsis

        if (!property) {
          return { success: false, content: '', error: t('agent.tools.readArchitecture.emptyFile', { name: fileName }) }
        }
        return { success: true, content: `${t('agent.tools.readArchitecture.fileContent', { name: fileName })}\n\n${property}` }
      }

      const contents: string[] = []
      if (core.premise) contents.push(`## 📄 premise.md\n\n${core.premise}`)
      if (core.worldbuilding) contents.push(`## 📄 worldbuilding.md\n\n${core.worldbuilding}`)
      if (core.charactersArch) contents.push(`## 📄 characters.md\n\n${core.charactersArch}`)
      if (core.synopsis) contents.push(`## 📄 synopsis.md\n\n${core.synopsis}`)

      if (contents.length === 0) {
        return { success: true, content: t('agent.tools.readArchitecture.empty') }
      }

      return { success: true, content: `${t('agent.tools.readArchitecture.allFiles', { count: contents.length })}\n\n${contents.join('\n\n---\n\n')}` }
    } catch (error) {
      return { success: false, content: '', error: t('agent.tools.readArchitecture.readFailed', { error: String(error) }) }
    }
  },
})
