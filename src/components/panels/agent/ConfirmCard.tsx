/**
 * ConfirmCard — 操作确认卡片
 *
 * 当 Agent 调用需要确认的 Tool 时显示此卡片。
 * 用户可以批准或拒绝操作。
 */
import { ShieldAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ToolCallInfo } from '../../../services/agent/agent-engine'
import { useAgentStore } from '../../../stores/agent-store'

interface Props {
  toolCall: ToolCallInfo
}

export default function ConfirmCard({ toolCall }: Props) {
  const { t } = useTranslation('panels')
  const { resolveToolConfirmation } = useAgentStore()
  const { id, toolName, arguments: args } = toolCall

  // 生成操作描述
  const description = generateDescription(toolName, args, t)

  return (
    <div className="confirm-card">
      {/* 头部 */}
      <div className="confirm-card-header">
        <ShieldAlert size={14} />
        <span>{t('agent.confirmAction')}</span>
      </div>

      {/* 内容 */}
      <div className="confirm-card-body">
        <div>{description}</div>
        {Object.keys(args).length > 0 && (
          <div
            style={{
              marginTop: 6,
              padding: '4px 8px',
              borderRadius: 4,
              backgroundColor: 'var(--color-hover)',
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: '0.68rem',
              color: 'var(--color-text-secondary)',
              whiteSpace: 'pre-wrap',
              maxHeight: 120,
              overflowY: 'auto',
            }}
          >
            {JSON.stringify(args, null, 2)}
          </div>
        )}
      </div>

      {/* 操作按钮 */}
      <div className="confirm-card-actions">
        <button
          className="confirm-card-btn reject"
          onClick={() => resolveToolConfirmation(id, false)}
        >
          {t('agent.reject')}
        </button>
        <button
          className="confirm-card-btn approve"
          onClick={() => resolveToolConfirmation(id, true)}
        >
          {t('agent.approveExecute')}
        </button>
      </div>
    </div>
  )
}

/** 根据 Tool 名称生成人类可读的操作描述 */
function generateDescription(toolName: string, args: Record<string, unknown>, t: (key: string, options?: Record<string, unknown>) => string): string {
  switch (toolName) {
    case 'write_file':
      return t('agent.willWriteFile', { path: args.file_path ?? t('agent.unknownPath') })
    case 'open_editor':
      return t('agent.willOpenInEditor', { path: args.file_path ?? t('agent.unknownFile') })
    case 'start_workflow':
      return t('agent.willStartWorkflow', { workflow: args.workflow ?? t('agent.unknownWorkflow') }) + (args.chapter_number ? t('agent.chapterNumber', { chapter: args.chapter_number }) : '')
    case 'update_config':
      return t('agent.willUpdateConfig', { field: args.field ?? t('agent.unknownField') })
    default:
      return t('agent.willExecuteAction', { tool: toolName })
  }
}
