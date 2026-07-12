import { useState, useEffect, useRef, useCallback } from 'react'
import { ChevronDown, ChevronRight, Globe, FolderOpen, RotateCcw, AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  BUILTIN_PROMPTS,
  EDITABLE_PROMPT_KEYS,
  getPromptTemplate,
  getPromptSource,
  getPromptName,
  getPromptDescription,
  saveCustomPrompt,
  saveProjectCustomPrompt,
  deleteCustomPrompt,
  deleteProjectCustomPrompt,
  loadProjectCustomPrompts,
  type PromptTemplate,
} from '../../services/prompt-templates'
import { useProjectStore } from '../../stores/project-store'
import { Button } from '../ui/Button'
import { cn } from '../../lib/utils'

// ==================== 来源标签配置 ====================

const SOURCE_CONFIG = {
  builtin: { labelKey: 'prompts.builtin', color: 'var(--color-text-muted)', bg: 'var(--color-hover)' },
  global: { labelKey: 'prompts.global', color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.1)' },
  project: { labelKey: 'prompts.project', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.1)' },
} as const

// ==================== 主组件 ====================

/** 提示词模板设置面板 */
export default function PromptSettings() {
  const { t } = useTranslation('settings')
  const project = useProjectStore((s) => s.currentProject)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  // 强制刷新用（保存/恢复后 getPromptSource 的结果会变）
  const [refreshKey, setRefreshKey] = useState(0)

  // 项目变更时重新加载项目级覆盖
  useEffect(() => {
    if (project?.path) {
      loadProjectCustomPrompts(project.path).then(() => setRefreshKey((k) => k + 1))
    }
  }, [project?.path])

  // 获取可编辑的模板列表
  const editableTemplates = BUILTIN_PROMPTS.filter((t) => EDITABLE_PROMPT_KEYS.includes(t.key))

  const handleToggle = (key: string) => {
    setExpandedKey((prev) => (prev === key ? null : key))
  }

  const triggerRefresh = useCallback(() => setRefreshKey((k) => k + 1), [])

  return (
    <div className="space-y-2" key={refreshKey}>
      {/* 说明 */}
      <div
        className="flex items-start gap-2 px-3 py-2.5 rounded-lg text-xs mb-4"
        style={{ backgroundColor: 'var(--color-hover)', color: 'var(--color-text-muted)' }}
      >
        <span className="flex-shrink-0 mt-0.5" style={{ color: 'var(--color-text-muted)' }}>{t('appearance.hint')}</span>
        <span dangerouslySetInnerHTML={{ __html: t('prompts.description') }} />
      </div>

      {editableTemplates.map((builtinTemplate) => {
        const source = getPromptSource(builtinTemplate.key)
        const currentTemplate = getPromptTemplate(builtinTemplate.key) ?? builtinTemplate
        const isExpanded = expandedKey === builtinTemplate.key

        return (
          <TemplateItem
            key={builtinTemplate.key}
            builtinTemplate={builtinTemplate}
            currentTemplate={currentTemplate}
            source={source}
            isExpanded={isExpanded}
            onToggle={() => handleToggle(builtinTemplate.key)}
            projectPath={project?.path ?? null}
            onSaved={triggerRefresh}
          />
        )
      })}
    </div>
  )
}

// ==================== 单个模板条目 ====================

function TemplateItem({
  builtinTemplate,
  currentTemplate,
  source,
  isExpanded,
  onToggle,
  projectPath,
  onSaved,
}: {
  builtinTemplate: PromptTemplate
  currentTemplate: PromptTemplate
  source: 'builtin' | 'global' | 'project'
  isExpanded: boolean
  onToggle: () => void
  projectPath: string | null
  onSaved: () => void
}) {
  const { t } = useTranslation('settings')
  const [editContent, setEditContent] = useState(currentTemplate.content)
  const [saving, setSaving] = useState(false)
  const [saveResult, setSaveResult] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const [prevExpanded, setPrevExpanded] = useState(isExpanded)
  const [prevContent, setPrevContent] = useState(currentTemplate.content)

  // 展开时重置编辑内容
  if (isExpanded !== prevExpanded || currentTemplate.content !== prevContent) {
    if (isExpanded) {
      setEditContent(currentTemplate.content)
      setSaveResult(null)
    }
    setPrevExpanded(isExpanded)
    setPrevContent(currentTemplate.content)
  }

  // 检查是否有被删除的变量
  const missingVars = Object.keys(builtinTemplate.variables).filter(
    (v) => builtinTemplate.content.includes(`{{${v}}}`) && !editContent.includes(`{{${v}}}`)
  )

  const sourceConf = SOURCE_CONFIG[source]

  // 插入变量到光标位置
  const insertVariable = (varName: string) => {
    const textarea = textareaRef.current
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const text = `{{${varName}}}`
    const newContent = editContent.slice(0, start) + text + editContent.slice(end)
    setEditContent(newContent)
    // 恢复光标
    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(start + text.length, start + text.length)
    })
  }

  // 保存到全局
  const handleSaveGlobal = async () => {
    setSaving(true)
    setSaveResult(null)
    const template: PromptTemplate = {
      ...builtinTemplate,
      content: editContent,
      // 不保存 systemSuffix，渲染时自动从内置取
    }
    delete (template as Partial<PromptTemplate>).systemSuffix
    const ok = await saveCustomPrompt(template)
    setSaving(false)
    setSaveResult(ok ? { type: 'success', msg: t('prompts.savedToGlobal') } : { type: 'error', msg: t('prompts.saveFailed') })
    if (ok) onSaved()
    setTimeout(() => setSaveResult(null), 3000)
  }

  // 保存到项目
  const handleSaveProject = async () => {
    if (!projectPath) return
    setSaving(true)
    setSaveResult(null)
    const template: PromptTemplate = {
      ...builtinTemplate,
      content: editContent,
    }
    delete (template as Partial<PromptTemplate>).systemSuffix
    const ok = await saveProjectCustomPrompt(projectPath, template)
    setSaving(false)
    setSaveResult(ok ? { type: 'success', msg: t('prompts.savedToProject') } : { type: 'error', msg: t('prompts.saveFailed') })
    if (ok) onSaved()
    setTimeout(() => setSaveResult(null), 3000)
  }

  // 恢复默认
  const handleReset = async () => {
    setSaving(true)
    setSaveResult(null)
    // 依次删除项目级和全局级覆盖
    if (projectPath) await deleteProjectCustomPrompt(projectPath, builtinTemplate.key)
    await deleteCustomPrompt(builtinTemplate.key)
    setEditContent(builtinTemplate.content)
    setSaving(false)
    setSaveResult({ type: 'success', msg: t('prompts.resetDone') })
    onSaved()
    setTimeout(() => setSaveResult(null), 3000)
  }

  return (
    <div
      className="rounded-xl overflow-hidden transition-colors"
      style={{
        border: `1px solid ${isExpanded ? 'var(--color-accent)' : 'var(--color-border)'}`,
        backgroundColor: 'var(--color-panel)',
      }}
    >
      {/* 折叠头部 */}
      <button
        className="w-full flex items-center gap-2.5 px-4 py-3 text-left transition-colors hover:bg-[var(--color-hover)] outline-none focus:outline-none"
        onClick={onToggle}
      >
        {isExpanded ? (
          <ChevronDown size={14} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
        ) : (
          <ChevronRight size={14} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
              {getPromptName(builtinTemplate.key)}
            </span>
            <span
              className="text-[0.65rem] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0"
              style={{ color: sourceConf.color, backgroundColor: sourceConf.bg }}
            >
              {t(sourceConf.labelKey)}
            </span>
          </div>
          <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--color-text-muted)' }}>
            {getPromptDescription(builtinTemplate.key)}
          </p>
        </div>
      </button>

      {/* 展开编辑区 */}
      {isExpanded && (
        <div className="px-4 pb-4 space-y-3" style={{ borderTop: '1px solid var(--color-border)' }}>
          {/* 变量标签栏 */}
          <div className="pt-3">
            <p className="text-[0.68rem] font-medium mb-1.5" style={{ color: 'var(--color-text-muted)' }}>
              {t('prompts.availableVariables')}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(builtinTemplate.variables).map(([varName, desc]) => (
                <button
                  key={varName}
                  onClick={() => insertVariable(varName)}
                  title={desc}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[0.68rem] transition-colors hover:bg-[var(--color-accent)] hover:text-white outline-none focus:outline-none"
                  style={{
                    backgroundColor: 'var(--color-hover)',
                    color: 'var(--color-text-secondary)',
                    border: '1px solid var(--color-border)',
                  }}
                >
                  <code className="font-mono">{`{{${varName}}}`}</code>
                  <span className="opacity-60 max-w-[120px] truncate">{desc}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 编辑 textarea */}
          <div>
            <textarea
              ref={textareaRef}
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              className="w-full rounded-lg px-3 py-2.5 text-xs font-mono resize-y outline-none focus:outline-none"
              style={{
                backgroundColor: 'var(--color-editor-bg)',
                color: 'var(--color-text)',
                border: '1px solid var(--color-border)',
                minHeight: '200px',
                maxHeight: '500px',
                lineHeight: 1.6,
                transition: 'border-color 0.15s ease',
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--color-accent)' }}
              onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)' }}
              spellCheck={false}
            />
          </div>

          {/* 变量缺失警告 */}
          {missingVars.length > 0 && (
            <div
              className="flex items-start gap-2 px-3 py-2 rounded-lg text-xs"
              style={{ backgroundColor: 'rgba(245, 158, 11, 0.08)', color: '#f59e0b' }}
            >
              <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
              <span>
                {t('prompts.missingVariablesWarning', { vars: missingVars.map(v => `{{${v}}}`).join(', ') })}
              </span>
            </div>
          )}


          {/* 操作按钮 */}
          <div className="flex items-center gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSaveGlobal}
              disabled={saving}
              title={t('prompts.saveToGlobalTooltip')}
            >
              <Globe size={12} />
              {t('prompts.saveToGlobal')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSaveProject}
              disabled={saving || !projectPath}
              title={projectPath ? t('prompts.saveToProjectTooltip') : t('prompts.noProject')}
            >
              <FolderOpen size={12} />
              {t('prompts.saveToProject')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              disabled={saving || source === 'builtin'}
              title={t('prompts.resetTooltip')}
            >
              <RotateCcw size={12} />
              {t('prompts.resetDefault')}
            </Button>
          </div>

          {/* 保存结果反馈 */}
          {saveResult && (
            <div
              className={cn(
                'text-xs px-3 py-1.5 rounded-lg',
                saveResult.type === 'success'
                  ? 'bg-green-500/10 text-green-500 border border-green-500/20'
                  : 'bg-red-500/10 text-red-500 border border-red-500/20'
              )}
            >
              {saveResult.type === 'success' ? '✅ ' : '❌ '}
              {saveResult.msg}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
