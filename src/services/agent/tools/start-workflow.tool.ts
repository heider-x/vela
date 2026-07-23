/**
 * start_workflow — 触发创作工作流
 */
import i18n from '../../../i18n'
import { buildAgentTool } from '../tool-registry'
import { useLayoutStore } from '../../../stores/layout-store'

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, { ns: 'panels', ...opts })

export const startWorkflowTool = buildAgentTool({
  name: 'start_workflow',
  description: t('agent.tools.startWorkflow.desc'),
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      workflow: {
        type: 'string',
        description: t('agent.tools.startWorkflow.workflowDesc'),
        enum: ['generate_draft', 'review', 'refine', 'finalize', 'generate_blueprint', 'generate_architecture'],
      },
      chapter_number: {
        type: 'number',
        description: t('agent.tools.startWorkflow.chapterNumberDesc'),
      },
    },
    required: ['workflow'],
  },
  requiresConfirmation: true,
  isReadOnly: false,
  execute: async (args) => {
    const workflow = args.workflow as string
    const chapterNumber = args.chapter_number as number | undefined

    if (!workflow) {
      return { success: false, content: '', error: t('agent.tools.startWorkflow.missingWorkflow') }
    }

    // 需要章节号的工作流
    const chapterWorkflows = ['generate_draft', 'review', 'refine', 'finalize']
    if (chapterWorkflows.includes(workflow) && chapterNumber === undefined) {
      return { success: false, content: '', error: t('agent.tools.startWorkflow.needsChapter', { workflow }) }
    }

    // 打开右侧面板到 AI 输出视图
    useLayoutStore.getState().openRightPanel('ai-output')

    // 注意：实际的工作流触发需要通过 workflow-store
    // 这里返回指导信息，让用户可以从 AI 输出面板操作
    const workflowNames: Record<string, string> = {
      generate_draft: t('agent.tools.startWorkflow.writeDraft'),
      review: t('agent.tools.startWorkflow.review'),
      refine: t('agent.tools.startWorkflow.refine'),
      finalize: t('agent.tools.startWorkflow.finalize'),
      generate_blueprint: t('agent.tools.startWorkflow.generateBlueprint'),
      generate_architecture: t('agent.tools.startWorkflow.generateArchitecture'),
    }

    const displayName = workflowNames[workflow] ?? workflow
    const chapterInfo = chapterNumber !== undefined ? t('agent.tools.startWorkflow.chapterInfo', { chapter: chapterNumber }) : ''

    return {
      success: true,
      content: t('agent.tools.startWorkflow.switched', { name: displayName, chapterInfo }),
      artifacts: [{ type: 'workflow_started', name: `${displayName}${chapterInfo}` }],
    }
  },
})
