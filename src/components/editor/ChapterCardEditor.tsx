import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Save, BookOpen, RefreshCw, Plus, Trash2,
  Sparkles, PenLine, GitBranch
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useProjectStore } from '../../stores/project-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import { useLayoutStore } from '../../stores/layout-store'
import { ipc } from '../../services/ipc-client'
import i18n from '../../i18n'
import {
  createDirectoryWorkflow,
  type ChapterBlueprint,
  type DirectoryWorkflowParams,
} from '../../services/workflows/directory-workflow'
import { guardDirectoryGeneration } from '../../services/workflow-guards'
import DirectoryConfigDialog from '../dialogs/DirectoryConfigDialog'
import StoryRehearsalDialog from '../dialogs/StoryRehearsalDialog'
import { appendRehearsalGuidance } from '../../services/story-rehearsal'
import type { RehearsalSession } from '../../shared/rehearsal-session'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Textarea } from '../ui/Textarea'
import { Label } from '../ui/Label'
import { NativeSelect } from '../ui/NativeSelect'
import { cn } from '../../lib/utils'
import { toast } from '../ui/Toast'
import { confirm } from '../ui/Confirm'
import { globalEventBus } from '../../shared/event-bus'

const ROLES = ['建置', '铺垫', '发展', '冲突', '高潮', '转折', '收尾']

const ROLE_LABELS: Record<string, string> = {
  '建置': 'chapterCard.roles.setup',
  '铺垫': 'chapterCard.roles.setupAlt',
  '发展': 'chapterCard.roles.development',
  '冲突': 'chapterCard.roles.conflict',
  '高潮': 'chapterCard.roles.climax',
  '转折': 'chapterCard.roles.turning',
  '收尾': 'chapterCard.roles.resolution',
}

const ROLE_COLORS: Record<string, string> = {
  高潮: 'bg-red-500/20 text-red-400',
  冲突: 'bg-orange-500/20 text-orange-400',
  转折: 'bg-purple-500/20 text-purple-400',
  建置: 'bg-blue-500/20 text-blue-400',
  收尾: 'bg-green-500/20 text-green-400',
  climax: 'bg-red-500/20 text-red-400',
  conflict: 'bg-orange-500/20 text-orange-400',
  turning: 'bg-purple-500/20 text-purple-400',
  setup: 'bg-blue-500/20 text-blue-400',
  setupAlt: 'bg-blue-500/20 text-blue-400',
  resolution: 'bg-green-500/20 text-green-400',
}

function getRoleLabel(role: string): string {
  const key = ROLE_LABELS[role]
  return key ? i18n.t(key, { ns: 'editors' }) : role
}

/** 章节蓝图编辑器 — 读写 directory.json */
export default function ChapterCardEditor() {
  const project = useProjectStore(s => s.currentProject)
  return <ChapterCardEditorSession key={project ? `${project.id}:${project.path}` : 'closed'} />
}

function ChapterCardEditorSession() {
  const { t } = useTranslation('editors')
  const currentProject = useProjectStore(s => s.currentProject)
  const projectId = currentProject?.id
  const projectPath = currentProject?.path
  // ✅ action 用 getState() 获取，不订阅 workflow store 高频更新
  const startWorkflow = useWorkflowStore.getState().startWorkflow
  const addLog = useWorkflowStore.getState().addLog
  const [blueprints, setBlueprints] = useState<ChapterBlueprint[]>([])
  const [selectedIdx, setSelectedIdx] = useState<number>(0)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [savedBlueprints, setSavedBlueprints] = useState<ChapterBlueprint[]>([])
  const [saveError, setSaveError] = useState('')
  const [generatedNotice, setGeneratedNotice] = useState('')
  const [rehearsalSessions, setRehearsalSessions] = useState(new Map<number, RehearsalSession>())
  const guidanceRef = useRef<HTMLTextAreaElement>(null)
  const [focusGuidance, setFocusGuidance] = useState(false)
  const [deletedBlueprints, setDeletedBlueprints] = useState<ChapterBlueprint[]>([])
  const dirty = JSON.stringify(blueprints) !== JSON.stringify(savedBlueprints)
  // 下一个可写的章节号
  const [nextWriteChapter, setNextWriteChapter] = useState<number | null>(null)

  // 蓝图生成弹窗（替代原 inline 批量面板）
  const [showBlueprintDialog, setShowBlueprintDialog] = useState(false)
  const [showRehearsal, setShowRehearsal] = useState(false)

  const loadBlueprints = useCallback(async () => {
    if (!projectId || !projectPath) return
    setLoading(true)
    try {
      const data = await ipc.invoke('db:blueprint-get-all', projectPath)
      // 获取下一个待写章节号
      const maxFinalized = await ipc.invoke('db:draft-get-max-finalized-chapter')
      const active = useProjectStore.getState().currentProject
      if (active?.id !== projectId || active.path !== projectPath) return
      setBlueprints(data)
      setSavedBlueprints(data)
      setDeletedBlueprints([])
      setSaveError('')
      if (data.length > 0) setSelectedIdx(0)
      setNextWriteChapter(maxFinalized !== null ? maxFinalized + 1 : 1)
    } catch {
      addLog('error', i18n.t('chapterCard.readBlueprintFailed', { ns: 'editors' }))
      setSaveError(i18n.t('chapterCard.readBlueprintFailed', { ns: 'editors' }))
    }
    setLoading(false)
  }, [projectId, projectPath, addLog])

  useEffect(() => {
    let mounted = true
    Promise.resolve().then(() => { if (mounted) loadBlueprints() })
    return () => { mounted = false }
  }, [loadBlueprints])

  // 监听工作流完成事件，如果蓝图生成完毕则自动刷新
  useEffect(() => {
    return globalEventBus.on('WORKFLOW_COMPLETE', (payload) => {
      if (payload.type === 'directory') {
        if (dirty) {
          toast.warning(t('rehearsal.externalBlueprintChange'))
          return
        }
        loadBlueprints()
      }
    })
  }, [loadBlueprints, dirty, t])

  useEffect(() => globalEventBus.on('BLUEPRINTS_UPDATED', payload => {
    if (payload.projectPath !== projectPath) return
    setGeneratedNotice(t(dirty ? 'chapterCard.generatedPending' : 'chapterCard.generatedVisible', { count: payload.count }))
    if (!dirty) void loadBlueprints()
  }), [projectPath, dirty, loadBlueprints, t])

  useEffect(() => globalEventBus.on('STORY_REVISED', payload => {
    if (payload.projectPath !== projectPath || !payload.revision.changes.some(c => c.kind === 'blueprint')) return
    if (dirty) { toast.warning(t('rehearsal.externalBlueprintChange')); return }
    void loadBlueprints()
  }), [projectPath, dirty, loadBlueprints, t])

  const selected = blueprints[selectedIdx] ?? null
  const selectedChapter = selected?.chapterNumber
  const rememberSession = useCallback((session: RehearsalSession) => {
    if (selectedChapter !== undefined) setRehearsalSessions(prev => new Map(prev).set(selectedChapter, session))
  }, [selectedChapter])
  const selectedDirty = !!selected && JSON.stringify(selected) !== JSON.stringify(savedBlueprints.find(bp => bp.chapterNumber === selected.chapterNumber))

  useEffect(() => {
    if (!showRehearsal && focusGuidance) {
      // Wait until the modal's focus restoration finishes.
      const timer = setTimeout(() => { guidanceRef.current?.focus(); guidanceRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }); setFocusGuidance(false) }, 350)
      return () => clearTimeout(timer)
    }
  }, [showRehearsal, focusGuidance])

  const reload = async () => {
    if (dirty && !await confirm(t('chapterCard.reloadUnsaved'), { confirmText: t('chapterCard.discardReload') })) return
    await loadBlueprints()
  }

  const commit = async (items: ChapterBlueprint[], deleted: number[]) => {
    const result = await ipc.invoke('db:blueprint-commit', items, deleted, savedBlueprints, currentProject!.path)
    if (!result.success) throw new Error(result.error?.includes('BLUEPRINT_CONFLICT') ? t('chapterCard.saveConflict') : result.error || 'SAVE_FAILED')
  }

  /** 更新选中章节蓝图的字段 */
  const updateField = <K extends keyof ChapterBlueprint>(key: K, value: ChapterBlueprint[K]) => {
    setBlueprints(prev =>
      prev.map((b, i) => (i === selectedIdx ? { ...b, [key]: value } : b))
    )
  }

  /** 保存当前章节蓝图 */
  const handleSaveOne = async () => {
    if (!currentProject || !selected) return
    setSaving(true)
    setSaveError('')
    try {
      await commit([selected], [])
      setSavedBlueprints(previous => {
        const saved = previous.filter(bp => bp.chapterNumber !== selected.chapterNumber)
        return [...saved, selected].sort((a, b) => a.chapterNumber - b.chapterNumber)
      })
      addLog('info', t('chapterCard.blueprintSaved', { chapter: selected.chapterNumber }))
      toast.success(t('chapterCard.blueprintSaved', { chapter: selected.chapterNumber }))
    } catch (error) {
      setSaveError(t('rehearsal.saveFailed', { message: String(error) }))
    } finally {
      setSaving(false)
    }
  }

  /** 全量保存（每章写入独立 JSON 文件） */
  const handleSaveAll = async () => {
    if (!currentProject) return
    setSaving(true)
    setSaveError('')
    try {
      const changed = blueprints.filter(bp => JSON.stringify(bp) !== JSON.stringify(savedBlueprints.find(saved => saved.chapterNumber === bp.chapterNumber)))
      const deleted = savedBlueprints.filter(bp => !blueprints.some(current => current.chapterNumber === bp.chapterNumber)).map(bp => bp.chapterNumber)
      await commit(changed, deleted)
      setSavedBlueprints(blueprints)
      setDeletedBlueprints([])
      addLog('info', t('chapterCard.allBlueprintsSaved', { count: blueprints.length }))
    } catch (error) {
      setSaveError(t('rehearsal.saveFailed', { message: String(error) }))
    } finally {
      setSaving(false)
    }
  }

  /** 新建空章节 */
  const handleAddChapter = () => {
    const maxNum = [...blueprints, ...savedBlueprints, ...deletedBlueprints].reduce((m, b) => Math.max(m, b.chapterNumber), 0)
    const newBlueprint: ChapterBlueprint = {
      chapterNumber: maxNum + 1,
      title: '',
      role: '发展',
      purpose: '',
      keyEvents: '',
      characters: [],
      suspenseHook: '',
      userGuidance: '',
      notes: '',
      notesUpdatedAt: '',
    }
    setBlueprints(prev => [...prev, newBlueprint])
    setSelectedIdx(blueprints.length)
  }

  /** 删除选中章节 */
  const handleDeleteChapter = async () => {
    if (!selected) return
    const ok = await confirm(t('chapterCard.deleteConfirmText', { chapter: selected.chapterNumber }), {
      title: t('chapterCard.deleteConfirmTitle'),
      confirmText: t('chapterCard.deleteConfirm'),
      danger: true,
    })
    if (!ok) return
    setDeletedBlueprints(prev => [...prev, selected])
    const newList = blueprints.filter((_, i) => i !== selectedIdx)
    setBlueprints(newList)
    setSelectedIdx(Math.max(0, selectedIdx - 1))
  }

  /** 触发蓝图批量生成（来自 DirectoryConfigDialog 的确认回调） */
  const handleBatchGenerate = async (params: DirectoryWorkflowParams) => {
    if (!currentProject) return

    // 前置校验：故事架构是否就绪
    const guard = await guardDirectoryGeneration()
    if (!guard.ok) {
      // 校验失败：阻断并提示
      addLog('error', t('chapterCard.guardFailed', { message: guard.message }))
      toast.warning(t('chapterCard.cannotStart', { message: guard.message }))
      return
    }
    if (guard.message) {
      // 有警告但允许继续：弹出确认
      const yes = await confirm(t('chapterCard.guardWarning', { message: guard.message }), {
        title: t('chapterCard.guardWarningTitle'),
        confirmText: t('chapterCard.continueGeneration'),
      })
      if (!yes) return
    }

    startWorkflow(createDirectoryWorkflow(params))
    addLog('info', t('chapterCard.workflowStarted'))
  }

  /**
   * 写作此章 — 将当前蓝图信息注入创作弹窗
   * 支持指定章节（默认为当前选中章）
   */
  const handleWriteChapter = (bp: ChapterBlueprint) => {
    // 通过 layout-store openChapterCreation 传递预填参数，替代 window.dispatchEvent
    useLayoutStore.getState().openChapterCreation({
      chapterNumber: bp.chapterNumber,
      title: bp.title,
      role: bp.role,
      purpose: bp.purpose,
      keyEvents: bp.keyEvents,
      characters: bp.characters.join('、'),
      userGuidance: bp.userGuidance || '',
    })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full gap-2" style={{ color: 'var(--color-text-muted)' }}>
        <RefreshCw size={16} className="animate-spin" /> {t('chapterCard.loadingBlueprints')}
      </div>
    )
  }

  if (!currentProject) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 opacity-40">
        <BookOpen size={36} />
        <span className="text-sm">{t('chapterCard.openProjectFirst')}</span>
      </div>
    )
  }

  return (
    <div className="@container h-full flex flex-col overflow-hidden">
      {/* 顶部工具栏 */}
      <div
        className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 flex-shrink-0 border-b"
        style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-sidebar)' }}
      >
        <div className="flex items-center gap-1.5">
          <BookOpen size={13} style={{ color: 'var(--color-text-muted)' }} />
          <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            {t('chapterCard.title')}
            {blueprints.length > 0 && (
              <span style={{ color: 'var(--color-text-muted)' }} className="ml-1 font-normal">
                {t('chapterCard.chapterCount', { count: blueprints.length })}
              </span>
            )}
          </span>
          {dirty && <span className="text-[0.7rem]" style={{ color: 'var(--color-accent)' }}>{t('chapterCard.unsaved')}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* 写作入口 — 仅下一章可写时显示 */}
          {nextWriteChapter !== null && blueprints.some(bp => bp.chapterNumber === nextWriteChapter) && (
            <Button
              variant="ai"
              size="sm"
              onClick={() => {
                const bp = blueprints.find(b => b.chapterNumber === nextWriteChapter)
                if (bp) handleWriteChapter(bp)
              }}
            >
              <PenLine size={12} />
              {t('chapterCard.writeChapter', { chapter: nextWriteChapter })}
            </Button>
          )}
          {/* AI 生成蓝图 → 弹出 DirectoryConfigDialog */}
          <Button
            variant="ai"
            size="sm"
            onClick={() => setShowBlueprintDialog(true)}
            title={t('chapterCard.aiGenerateBlueprintTooltip')}
          >
            <Sparkles size={12} />
            {t('chapterCard.aiGenerateBlueprint')}
          </Button>
          <Button variant="ghost" size="icon" onClick={() => void reload()} title={t('chapterCard.reload')} aria-label={t('chapterCard.reload')} disabled={loading || saving}>
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </Button>
          <Button variant="outline" size="sm" onClick={handleAddChapter} disabled={saving} title={t('chapterCard.newChapter')}>
            <Plus size={14} />
            {t('chapterCard.newChapter')}
          </Button>
          {dirty && (
            <Button variant="outline" size="sm" onClick={handleSaveAll} disabled={saving}>
              <Save size={12} /> {saving ? t('chapterCard.saving') : t('chapterCard.saveAll')}
            </Button>
          )}
        </div>
      </div>
      {saveError && <p role="alert" className="px-4 py-3 text-sm text-[var(--color-error)] border-b border-[var(--color-border)]">{saveError}</p>}
      {generatedNotice && <div role="status" className="px-4 py-2 text-sm border-b border-[var(--color-border)] flex flex-wrap items-center gap-2">
        <span>{generatedNotice}</span>
        {dirty && <Button variant="outline" onClick={() => void reload()}>{t('chapterCard.viewGenerated')}</Button>}
      </div>}
      {deletedBlueprints.length > 0 && <div role="status" className="px-4 py-2 flex flex-wrap items-center gap-3 text-sm border-b border-[var(--color-border)]">
        <span>{t('chapterCard.pendingDelete', { count: deletedBlueprints.length })}</span>
        <Button variant="outline" disabled={saving} onClick={() => {
          setBlueprints(prev => [...prev, ...deletedBlueprints].sort((a, b) => a.chapterNumber - b.chapterNumber))
          setDeletedBlueprints([])
        }}>{t('chapterCard.undoDelete')}</Button>
      </div>}

      {/* 蓝图生成配置弹窗 */}
      <DirectoryConfigDialog
        isOpen={showBlueprintDialog}
        onClose={() => setShowBlueprintDialog(false)}
        existingCount={blueprints.length}
        onConfirm={handleBatchGenerate}
      />
      {selected && <StoryRehearsalDialog
        key={selected.chapterNumber}
        project={currentProject}
        blueprint={selected}
        isOpen={showRehearsal}
        session={rehearsalSessions.get(selected.chapterNumber)}
        onSessionChange={rememberSession}
        onClose={() => setShowRehearsal(false)}
        onAdopt={(guidance, original) => {
          const activeProject = useProjectStore.getState().currentProject
          if (activeProject?.id !== currentProject.id || activeProject.path !== currentProject.path ||
              JSON.stringify(selected) !== JSON.stringify(original)) return false
          setBlueprints(prev => prev.map((bp, index) => index === selectedIdx ? appendRehearsalGuidance(bp, guidance) : bp))
          setFocusGuidance(true)
          toast.success(t('rehearsal.adopted'))
          return true
        }}
      />}

      {/* 主区域：左侧列表 + 右侧编辑 */}
      <div className="flex-1 flex flex-col @xl:flex-row min-h-0 overflow-hidden">
        {/* 左侧章节列表 */}
        <div
          className="flex flex-col shrink-0 w-full @xl:w-44 @4xl:w-56 max-h-36 @xl:max-h-none border-r border-b overflow-hidden"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-sidebar)' }}
        >
          {blueprints.length === 0 ? (
            <div className="flex flex-col items-center justify-center flex-1 gap-3 opacity-40 p-4">
              <BookOpen size={28} />
              <span className="text-xs text-center">{t('chapterCard.noBlueprints')}</span>
            </div>
          ) : (
          <div className="flex-1 overflow-y-auto p-1">
            {blueprints.map((bp, idx) => (
              <button type="button" aria-pressed={selectedIdx === idx}
                key={bp.chapterNumber}
                className={cn(
                  'group relative w-full text-left px-3 py-3 rounded-md text-sm cursor-pointer mb-0.5 transition-colors',
                  selectedIdx === idx
                    ? 'bg-[var(--color-active)] text-[var(--color-text)]'
                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)]'
                )}
                onClick={() => setSelectedIdx(idx)}
              >
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[0.7rem] opacity-40 flex-shrink-0">
                    {bp.chapterNumber}
                  </span>
                  <span className="font-medium truncate flex-1">{bp.title || t('chapterCard.unnamed')}</span>
                </div>
                <div className="flex items-center gap-1 mt-0.5">
                  <span className={cn(
                    'text-[0.7rem] px-1 py-0.5 rounded',
                    ROLE_COLORS[bp.role] || 'bg-[var(--color-hover)] text-[var(--color-text-muted)]'
                  )}>
                    {getRoleLabel(bp.role)}
                  </span>
                  {bp.userGuidance && (
                    <span
                      className="text-[0.7rem] px-1 py-0.5 rounded"
                      style={{ backgroundColor: 'rgba(var(--accent-rgb), 0.15)', color: 'var(--color-accent)' }}
                      title={t('chapterCard.hasGuidanceTooltip')}
                    >
                      {t('chapterCard.hasGuidance')}
                    </span>
                  )}
                  {bp.notes && (
                    <span
                      className="text-[0.7rem] px-1 py-0.5 rounded"
                      style={{ backgroundColor: 'rgba(34,197,94,0.15)', color: 'rgb(34,197,94)' }}
                      title={t('chapterCard.hasNotesTooltip')}
                    >
                      {t('chapterCard.hasNotes')}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
          )}
        </div>

        {/* 右侧编辑区 */}
        <div className="flex-1 min-w-0 min-h-0 overflow-y-auto">
          {selected ? (
            <div className="max-w-3xl mx-auto px-5 py-5 [&_textarea]:text-sm [&_textarea]:leading-7">
              {/* 编辑区头部 */}
              <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                <h3 className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>
                  {t('chapterCard.chapterTitle', { chapter: selected.chapterNumber, title: selected.title || t('chapterCard.unnamed') })}
                </h3>
                <div className="flex flex-wrap items-center gap-2">
                  {/* 仅下一章允许写作 */}
                  <Button variant="outline" size="sm" disabled={saving} onClick={() => setShowRehearsal(true)}>
                    <GitBranch size={13} />{t('rehearsal.title')}
                  </Button>
                  {nextWriteChapter !== null && selected.chapterNumber === nextWriteChapter && (
                    <Button
                      variant="ai"
                      size="sm"
                      onClick={() => handleWriteChapter(selected)}
                      title={t('chapterCard.writeThisChapterTooltip')}
                    >
                      <PenLine size={12} /> {t('chapterCard.writeThisChapter')}
                    </Button>
                  )}
                  <Button variant="ghost" size="icon" disabled={saving} onClick={handleDeleteChapter} title={t('chapterCard.deleteThisChapter')} aria-label={t('chapterCard.deleteThisChapter')}>
                    <Trash2 size={13} style={{ color: 'var(--color-text-muted)' }} />
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleSaveOne} disabled={saving || !selectedDirty}>
                    <Save size={12} /> {saving ? t('chapterCard.saving') : t('chapterCard.save')}
                  </Button>
                </div>
              </div>

              <div className="space-y-3">
                {/* 基本信息 */}
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <Label htmlFor="blueprint-number">{t('chapterCard.chapterNumber')}</Label>
                    <Input
                      id="blueprint-number"
                      type="number"
                      value={selected.chapterNumber}
                      readOnly title={t('chapterCard.numberFixed')}
                    />
                  </div>
                  <div className="col-span-2">
                    <Label htmlFor="blueprint-title">{t('chapterCard.chapterTitleLabel')}</Label>
                    <Input
                      id="blueprint-title"
                      value={selected.title}
                      onChange={e => updateField('title', e.target.value)}
                      placeholder={t('chapterCard.chapterTitlePlaceholder')}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>{t('chapterCard.chapterRole')}</Label>
                    <NativeSelect value={selected.role} onChange={e => updateField('role', e.target.value)}>
                      {ROLES.map(r => <option key={r} value={r}>{getRoleLabel(r)}</option>)}
                    </NativeSelect>
                  </div>
                  <div>
                    <Label>{t('chapterCard.charactersLabel')}</Label>
                    <Input
                      value={selected.characters.join('、')}
                      onChange={e => updateField('characters', e.target.value.split(/[,，、\s]+/).filter(Boolean))}
                      placeholder={t('chapterCard.charactersPlaceholder')}
                    />
                  </div>
                </div>

                <div>
                  <Label>{t('chapterCard.purpose')}</Label>
                  <Textarea
                    value={selected.purpose}
                    onChange={e => updateField('purpose', e.target.value)}
                    placeholder={t('chapterCard.purposePlaceholder')}
                    rows={2}
                  />
                </div>

                <div>
                  <Label>{t('chapterCard.keyEvents')}</Label>
                  <Textarea
                    value={selected.keyEvents}
                    onChange={e => updateField('keyEvents', e.target.value)}
                    placeholder={t('chapterCard.keyEventsPlaceholder')}
                    rows={4}
                  />
                </div>

                <div>
                  <Label>{t('chapterCard.suspenseHook')}</Label>
                  <Textarea
                    value={selected.suspenseHook}
                    onChange={e => updateField('suspenseHook', e.target.value)}
                    placeholder={t('chapterCard.suspenseHookPlaceholder')}
                    rows={2}
                  />
                </div>

                {/* 作者微操指导 — 特别标注，写稿时注入为最高优先级 */}
                <div
                  className="p-3 rounded-lg border"
                  style={{
                    borderColor: 'var(--color-accent)',
                    backgroundColor: 'rgba(var(--accent-rgb, 99 102 241), 0.06)',
                  }}
                >
                  <Label htmlFor="blueprint-guidance" className="flex flex-wrap items-center gap-1.5">
                    <span>{t('chapterCard.authorGuidance')}</span>
                    <span
                      className="text-[0.7rem] font-normal"
                      style={{ color: 'var(--color-text-muted)' }}
                    >
                      {t('chapterCard.authorGuidanceHint')}
                    </span>
                  </Label>
                  <Textarea
                    id="blueprint-guidance" ref={guidanceRef}
                    value={selected.userGuidance}
                    onChange={e => updateField('userGuidance', e.target.value)}
                    placeholder={t('chapterCard.authorGuidancePlaceholder')}
                    rows={3}
                    style={{ marginTop: 6 }}
                  />
                </div>
                {/* 章节要点（定稿后自动生成，也可手动编辑） */}
                <div
                  className="p-3 rounded-lg border"
                  style={{
                    borderColor: 'var(--color-border)',
                    backgroundColor: 'rgba(34,197,94,0.04)',
                  }}
                >
                  <Label className="flex items-center gap-1.5">
                    <span>{t('chapterCard.chapterNotes')}</span>
                    <span
                      className="text-[0.7rem] font-normal"
                      style={{ color: 'var(--color-text-muted)' }}
                    >
                      {selected.notesUpdatedAt
                        ? t('chapterCard.chapterNotesGenerated', { date: new Date(selected.notesUpdatedAt).toLocaleDateString() })
                        : t('chapterCard.chapterNotesManual')
                      }
                    </span>
                  </Label>
                  <Textarea
                    value={selected.notes || ''}
                    onChange={e => updateField('notes', e.target.value)}
                    placeholder={t('chapterCard.chapterNotesPlaceholder')}
                    rows={4}
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-4 px-6 text-center text-[var(--color-text-secondary)]">
              <BookOpen size={36} />
              <span className="text-sm">{t(blueprints.length ? 'chapterCard.selectChapter' : 'chapterCard.emptyStart')}</span>
              {!blueprints.length && <Button onClick={handleAddChapter}><Plus size={16} />{t('chapterCard.createFirst')}</Button>}
            </div>
          )}
        </div>
      </div>
      {selected && <div className="shrink-0 px-4 py-3 border-t border-[var(--color-border)] flex flex-wrap items-center justify-between gap-2 bg-[var(--color-sidebar)]">
        <span className="text-sm text-[var(--color-text-secondary)]">{t(selectedDirty ? 'chapterCard.chapterPending' : 'chapterCard.chapterSaved', { chapter: selected.chapterNumber })}</span>
        <Button onClick={handleSaveOne} disabled={saving || !selectedDirty}><Save size={14} />{t('chapterCard.saveCurrent')}</Button>
      </div>}
    </div>
  )
}
