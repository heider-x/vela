/**
 * ArtifactCard — 产物卡片
 *
 * 当 Agent 创建/修改文件或触发工作流时，
 * 显示可点击的产物卡片，用户可直接跳转到对应资源。
 */
import { FileText, FolderOpen, Play, ExternalLink } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ToolArtifact } from '../../../services/agent/tool-registry'
import { useEditorStore } from '../../../stores/editor-store'
import { ipc } from '../../../services/ipc-client'
import { useAgentStore } from '../../../stores/agent-store'

interface Props {
  artifact: ToolArtifact
}

/** 根据产物类型选择图标 */
function ArtifactIcon({ type }: { type: ToolArtifact['type'] }) {
  switch (type) {
    case 'file_created':
      return <FileText size={13} />
    case 'file_modified':
      return <FolderOpen size={13} />
    case 'workflow_started':
      return <Play size={13} />
    case 'tab_opened':
      return <ExternalLink size={13} />
    default:
      return <FileText size={13} />
  }
}

/** 产物类型标签 */
function typeLabel(type: ToolArtifact['type'], t: (key: string) => string): string {
  switch (type) {
    case 'file_created': return t('artifact.fileCreated')
    case 'file_modified': return t('artifact.fileModified')
    case 'workflow_started': return t('artifact.workflowStarted')
    case 'tab_opened': return t('artifact.tabOpened')
    default: return ''
  }
}

export default function ArtifactCard({ artifact }: Props) {
  const { t } = useTranslation('panels')
  const { type, name, path } = artifact

  if (type === 'story_revision') return <button className="artifact-card w-full text-left" onClick={() => useAgentStore.getState().setShowStoryHistory(true)}><FileText size={14} /><span className="artifact-name">{name}</span><span className="artifact-type">{t('storyRevision.view')}</span></button>

  const handleClick = async () => {
    if (path && (type === 'file_created' || type === 'file_modified' || type === 'tab_opened')) {
      // 先读取文件内容，再打开编辑器（避免空白 Tab）
      let content = ''
      try {
        const result = await ipc.invoke('fs:read-file', path)
        if (result.success) {
          content = result.content
        }
      } catch {
        // 读取失败时仍然打开，显示空白
      }
      useEditorStore.getState().openFile({
        id: `artifact-${Date.now()}`,
        name,
        type: 'chapter',
        filePath: path,
        content,
      })
    }
  }

  return (
    <div className="artifact-card" onClick={handleClick}>
      <div className="artifact-icon">
        <ArtifactIcon type={type} />
      </div>
      <span className="artifact-name">{name}</span>
      <span className="artifact-type">{typeLabel(type, t)}</span>
    </div>
  )
}
