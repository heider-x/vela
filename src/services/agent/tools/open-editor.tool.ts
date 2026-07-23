/**
 * open_editor — 在编辑器中打开文件
 */
import i18n from '../../../i18n'
import { buildAgentTool } from '../tool-registry'
import { useEditorStore } from '../../../stores/editor-store'
import { useProjectStore } from '../../../stores/project-store'
import { ipc } from '../../ipc-client'
import { validatePath } from './safe-path'

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, { ns: 'panels', ...opts })

export const openEditorTool = buildAgentTool({
  name: 'open_editor',
  description: t('agent.tools.openEditor.desc'),
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: {
        type: 'string',
        description: t('agent.tools.openEditor.filePathDesc'),
      },
      tab_type: {
        type: 'string',
        description: t('agent.tools.openEditor.tabTypeDesc'),
        enum: ['chapter', 'outline', 'character', 'config', 'arch-file'],
        default: 'chapter',
      },
    },
    required: ['file_path'],
  },
  requiresConfirmation: true,
  isReadOnly: false,
  execute: async (args) => {
    const filePath = args.file_path as string
    const tabType = (args.tab_type as string) ?? 'chapter'

    if (!filePath) {
      return { success: false, content: '', error: t('agent.tools.openEditor.missingFilePath') }
    }

    const project = useProjectStore.getState().currentProject
    if (!project) {
      return { success: false, content: '', error: t('agent.tools.noProject') }
    }

    const fullPath_check = validatePath(project.path, filePath)
    if (!fullPath_check.valid) {
      return { success: false, content: '', error: fullPath_check.error }
    }
    const fullPath = fullPath_check.fullPath

    // 读取文件内容
    const result = await ipc.invoke('fs:read-file', fullPath)
    if (!result.success) {
      return { success: false, content: '', error: t('agent.tools.openEditor.readFailed', { error: result.error }) }
    }

    // 在编辑器中打开
    const fileName = filePath.split('/').pop() ?? filePath
    useEditorStore.getState().openFile({
      id: `agent-${Date.now()}`,
      name: fileName,
      type: tabType as 'chapter' | 'outline' | 'character' | 'config' | 'arch-file',
      filePath: fullPath,
      content: result.content,
    })

    return {
      success: true,
      content: t('agent.tools.openEditor.opened', { name: fileName }),
      artifacts: [{ type: 'tab_opened', path: fullPath, name: fileName }],
    }
  },
})
