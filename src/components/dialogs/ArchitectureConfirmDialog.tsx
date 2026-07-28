import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Wand2, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react'
import { useProjectStore } from '../../stores/project-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import { guardArchitectureGeneration, guardCharacterRegeneration } from '../../services/workflow-guards'
import { toast } from '../ui/Toast'
import {
  Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription,
} from '../ui/Dialog'
import { Button } from '../ui/Button'
import { Textarea } from '../ui/Textarea'

type ArchStepKey = 'premise' | 'characters' | 'worldbuilding' | 'synopsis'

const ARCH_FILES: Array<{
  key: ArchStepKey
  fileName: string
  label: string
  iconName: string
  desc: string
}> = [
  { key: 'premise',       fileName: 'premise.md',       label: '故事前提', iconName: 'target', desc: 'Logline、核心冲突、金手指定位' },
  { key: 'characters',    fileName: 'characters.md',    label: '角色图谱', iconName: 'users',  desc: '角色弧光、关系网、矛盾交织' },
  { key: 'worldbuilding', fileName: 'worldbuilding.md', label: '世界观',   iconName: 'globe',  desc: '核心规则、阶层断层、深层危机' },
  { key: 'synopsis',      fileName: 'synopsis.md',      label: '情节大纲', iconName: 'map',    desc: '三幕式情节骨架' },
]

interface Props {
  isOpen: boolean
  onClose: () => void
  /** 各架构文件的生成状态 */
  archStatus: Record<string, boolean>
  /** 预先选中的步骤（单文件生成时传入） */
  initialSelectedSteps?: ArchStepKey[]
  onConfirm: (selectedSteps: ArchStepKey[], stepGuidance: Record<string, string>) => void
}

/** 生成架构确认弹框（含步骤勾选） */
export default function ArchitectureConfirmDialog({
  isOpen, onClose, archStatus, initialSelectedSteps, onConfirm,
}: Props) {
  const { t } = useTranslation('dialogs')
  const currentProject = useProjectStore(s => s.currentProject)

  // Translation mappings for ARCH_FILES labels
  const archLabels: Record<ArchStepKey, string> = {
    premise: t('architectureConfirm.premise'),
    characters: t('architectureConfirm.characterMap'),
    worldbuilding: t('architectureConfirm.worldbuilding'),
    synopsis: t('architectureConfirm.synopsis'),
  }

  const archDescs: Record<ArchStepKey, string> = {
    premise: t('architectureConfirm.premiseDesc'),
    characters: t('architectureConfirm.characterMapDesc'),
    worldbuilding: t('architectureConfirm.worldbuildingDesc'),
    synopsis: t('architectureConfirm.synopsisDesc'),
  }

  // 默认：未生成的全部勾选；或使用 initialSelectedSteps 覆盖
  const [checked, setChecked] = useState<Record<ArchStepKey, boolean>>(() => {
    if (initialSelectedSteps) {
      return {
        premise:      initialSelectedSteps.includes('premise'),
        characters:   initialSelectedSteps.includes('characters'),
        worldbuilding: initialSelectedSteps.includes('worldbuilding'),
        synopsis:     initialSelectedSteps.includes('synopsis'),
      }
    }
    return {
      premise:      !archStatus.premise,
      characters:   !archStatus.characters,
      worldbuilding: !archStatus.worldbuilding,
      synopsis:     !archStatus.synopsis,
    }
  })

  // 每步的补充指导
  const [stepGuidance, setStepGuidance] = useState<Record<string, string>>({})
  // 是否展开指导输入区
  const [showGuidance, setShowGuidance] = useState(false)

  // 每次弹窗打开时重置选中状态
  const resetChecked = () => {
    if (initialSelectedSteps) {
      setChecked({
        premise:      initialSelectedSteps.includes('premise'),
        characters:   initialSelectedSteps.includes('characters'),
        worldbuilding: initialSelectedSteps.includes('worldbuilding'),
        synopsis:     initialSelectedSteps.includes('synopsis'),
      })
    } else {
      setChecked({
        premise:      !archStatus.premise,
        characters:   !archStatus.characters,
        worldbuilding: !archStatus.worldbuilding,
        synopsis:     !archStatus.synopsis,
      })
    }
  }

  const isArchRunning = useWorkflowStore(s => s.isTypeRunning('architecture_generation'))
  const [isConfirming, setIsConfirming] = useState(false)
  const [guardError, setGuardError] = useState<string | null>(null)

  if (!currentProject) return null
  const config = currentProject.novelConfig

  const toggleStep = (key: ArchStepKey) =>
    setChecked(prev => ({ ...prev, [key]: !prev[key] }))

  const selectedSteps = (Object.keys(checked) as ArchStepKey[]).filter(k => checked[k])
  const noneSelected = selectedSteps.length === 0

  const handleConfirm = async () => {
    if (noneSelected) return
    // 防重复：同类型工作流正在运行
    if (isArchRunning) {
      toast.warning(t('architectureConfirm.taskRunning'))
      return
    }

    setIsConfirming(true)
    try {
      // 前置校验 1：小说配置是否填写
      const configGuard = guardArchitectureGeneration()
      if (!configGuard.ok) {
        setGuardError(configGuard.message || t('architectureConfirm.configValidationFailed'))
        return
      }

      // 前置校验 2：如果勾选了角色图谱（意味着将重新生成角色卡），则必须确保蓝图为空
      if (selectedSteps.includes('characters') && archStatus.characters) {
        const charGuard = await guardCharacterRegeneration()
        if (!charGuard.ok) {
          setGuardError(charGuard.message || t('architectureConfirm.characterCardNotRegenerable'))
          return
        }
      }

      setGuardError(null)
      onConfirm(selectedSteps, stepGuidance)
      onClose()
      const stepNames = selectedSteps.map(k => archLabels[k]).filter(Boolean).join('、')
      toast.info(t('architectureConfirm.submitted', { stepNames }))
    } finally {
      setIsConfirming(false)
    }
  }

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      onClose()
    } else {
      resetChecked()
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 size={16} className="text-[var(--color-accent)]" />
            {t('architectureConfirm.title')}
          </DialogTitle>
          <DialogDescription>
            {t('architectureConfirm.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 py-3 space-y-4">
          {/* 配置预览 */}
          <div
            className="rounded-lg p-3 space-y-1.5 text-xs"
            style={{ backgroundColor: 'var(--color-panel)', border: '1px solid var(--color-border)' }}
          >
            <p className="font-medium text-[0.7rem] mb-2" style={{ color: 'var(--color-text-muted)' }}>
              {t('architectureConfirm.currentConfig')}
            </p>
            <div className="grid grid-cols-2 gap-1">
              <ConfigRow label={t('architectureConfirm.genre')} value={[config.genre, config.subGenre].filter(Boolean).join(' · ')} />
              <ConfigRow label={t('architectureConfirm.audience')} value={config.targetAudience} />
              <ConfigRow label={t('architectureConfirm.totalChaptersLabel')} value={`${config.totalChapters} ${t('common.chapters', { ns: 'common' })}`} />
              <ConfigRow label={t('architectureConfirm.wordsPerChapterLabel')} value={`${config.wordsPerChapter} ${t('common.words', { ns: 'common' })}`} />
            </div>
            {config.coreOutline && (
              <p
                className="mt-1.5 pt-1.5 text-xs"
                style={{ borderTop: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}
              >
                {config.coreOutline.slice(0, 80)}{config.coreOutline.length > 80 ? '...' : ''}
              </p>
            )}
          </div>

          {/* 步骤勾选列表 */}
          <div
            className="rounded-lg p-3 space-y-2.5"
            style={{ backgroundColor: 'var(--color-panel)', border: '1px solid var(--color-border)' }}
          >
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-medium" style={{ color: 'var(--color-text-muted)' }}>
                {t('architectureConfirm.selectSteps')}
              </p>
              <button
                onClick={() => setChecked({ premise: true, characters: true, worldbuilding: true, synopsis: true })}
                className="text-xs underline"
                style={{ color: 'var(--color-text-muted)' }}
              >
                {t('common.selectAll', { ns: 'common' })}
              </button>
            </div>

            {ARCH_FILES.map(f => {
              const exists = archStatus[f.key]
              const isChecked = checked[f.key]
              return (
                <label
                  key={f.key}
                  className="flex items-center gap-2.5 cursor-pointer select-none"
                  onClick={() => toggleStep(f.key)}
                >
                  {/* 复选框 */}
                  <div
                    className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0 transition-all"
                    style={{
                      backgroundColor: isChecked ? 'var(--color-accent)' : 'transparent',
                      border: `1.5px solid ${isChecked ? 'var(--color-accent)' : 'var(--color-border)'}`,
                    }}
                  >
                    {isChecked && (
                      <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
                        <path d="M1 3L3.5 5.5L8 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>

                  {/* 步骤名 */}
                  <span className="text-xs flex-1" style={{ color: isChecked ? 'var(--color-text)' : 'var(--color-text-muted)' }}>
                    {archLabels[f.key]}
                    <span className="ml-1 text-[0.7rem]" style={{ color: 'var(--color-text-muted)' }}>
                      — {archDescs[f.key]}
                    </span>
                  </span>

                  {/* 状态标签 */}
                  <span
                    className={`text-[0.7rem] px-1.5 py-0.5 rounded flex-shrink-0 ${
                      exists
                        ? isChecked
                          ? 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400'
                          : 'bg-green-500/10 text-green-600 dark:text-green-400'
                        : 'bg-[rgba(var(--color-accent-rgb),0.1)] text-[var(--color-accent)]'
                    }`}
                  >
                    {exists ? (isChecked ? t('architectureConfirm.willOverride') : t('architectureConfirm.keep')) : t('architectureConfirm.pending')}
                  </span>
                </label>
              )
            })}
          </div>

          {/* 逐步指导区域（可折叠） */}
          {selectedSteps.length > 0 && (
            <div
              className="rounded-lg overflow-hidden"
              style={{ border: '1px solid var(--color-border)' }}
            >
              <button
                className="w-full flex items-center gap-2 px-3 py-2 text-xs font-medium cursor-pointer"
                style={{ color: 'var(--color-text-muted)', backgroundColor: 'var(--color-panel)' }}
                onClick={() => setShowGuidance(!showGuidance)}
              >
                {showGuidance ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {t('architectureConfirm.stepGuidance')}
              </button>
              {showGuidance && (
                <div className="px-3 pb-3 space-y-3" style={{ backgroundColor: 'var(--color-panel)' }}>
                  {ARCH_FILES.filter(f => checked[f.key]).map(f => (
                    <div key={f.key}>
                      <label className="text-[0.7rem] font-medium mb-1 block" style={{ color: 'var(--color-text-muted)' }}>
                        {archLabels[f.key]}
                      </label>
                      <Textarea
                        value={stepGuidance[f.key] || ''}
                        onChange={e => setStepGuidance(prev => ({ ...prev, [f.key]: e.target.value }))}
                        placeholder={t('architectureConfirm.stepPlaceholder', { label: archLabels[f.key] })}
                        rows={2}
                        className="text-xs"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {noneSelected && (
            <p className="text-xs px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400">
              ⚠️ {t('architectureConfirm.noStepSelected')}
            </p>
          )}
          {/* 前置校验失败提示 */}
          {guardError && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg text-xs bg-yellow-500/10 border border-yellow-500/30 text-yellow-600 dark:text-yellow-400">
              <AlertCircle size={13} className="flex-shrink-0 mt-0.5 text-yellow-500" />
              <span className="whitespace-pre-line">{guardError}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isConfirming}>{t('common.cancel', { ns: 'common' })}</Button>
          <Button variant="default" onClick={handleConfirm} disabled={noneSelected || isConfirming}>
            <Wand2 size={13} />
            {isConfirming ? t('architectureConfirm.validating') : t('architectureConfirm.confirmGeneration', { count: selectedSteps.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  const { t } = useTranslation('dialogs')
  return (
    <div className="flex items-center gap-1 text-xs">
      <span style={{ color: 'var(--color-text-muted)' }}>{label}{t('architectureConfirm.labelSeparator')}</span>
      <span style={{ color: 'var(--color-text)' }}>{value || t('architectureConfirm.emptyConfig')}</span>
    </div>
  )
}

