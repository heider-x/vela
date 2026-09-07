/** Legacy compatibility only. Never advertise an unimplemented executor as a capability. */
import { buildAgentTool } from '../tool-registry'

export const startWorkflowTool = buildAgentTool({
  name: 'start_workflow',
  description: '旧版工作流入口，未接入执行，不再注册到可用工具。',
  source: 'builtin', requiresConfirmation: false, isReadOnly: true,
  inputSchema: { type: 'object', properties: {} },
  execute: async () => ({
    success: false, content: '',
    error: '未启动任何工作流，未生成或修改正文。修改已有草稿请使用 read_story 完整读取，再用 revise_story（edit_written_text=true）保存；其他尚未接入的操作必须明确告知作者。',
  }),
})
