import { useEffect, useRef, useState } from 'react'
import { GitBranch, LoaderCircle, PenLine } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ProjectData } from '../../shared/ipc-channels'
import type { ChapterBlueprint } from '../../services/workflows/directory-workflow'
import type { RehearsalDirection } from '../../shared/story-rehearsal'
import { DIRECTION_FIELDS } from '../../shared/story-rehearsal'
import { useProjectStore } from '../../stores/project-store'
import { useLLMStore } from '../../stores/llm-store'
import { ipc } from '../../services/ipc-client'
import {
  buildRehearsalSceneMessages, cleanRehearsalText, appendRehearsalGuidance,
  generateRehearsalDirections, type RehearsalInput,
} from '../../services/story-rehearsal'
import { streamRehearsal } from '../../services/rehearsal-stream'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { Textarea } from '../ui/Textarea'
import { Label } from '../ui/Label'
import { NativeSelect } from '../ui/NativeSelect'
import { emptyRehearsalSession, type RehearsalSession, type RehearsalScene, type RehearsalResult } from '../../shared/rehearsal-session'

interface Props {
  project: ProjectData
  blueprint: ChapterBlueprint
  isOpen: boolean
  onClose: () => void
  onAdopt: (guidance: string, original: ChapterBlueprint) => boolean
  session?: RehearsalSession
  onSessionChange: (session: RehearsalSession) => void
}

export default function StoryRehearsalDialog({ project, blueprint, isOpen, onClose, onAdopt, session, onSessionChange }: Props) {
  const { t, i18n } = useTranslation('editors')
  const models = useLLMStore(s => s.models)
  const defaultModelId = useLLMStore(s => s.defaultModelId)
  const [modelChoice, setModelChoice] = useState('')
  const generationModels = models.filter(m => !m.purposes.includes('embedding') || m.purposes.includes('generation'))
  const modelId = (generationModels.some(m => m.id === modelChoice) ? modelChoice :
    generationModels.some(m => m.id === defaultModelId) ? defaultModelId : generationModels[0]?.id) || ''
  const maxTokens = Math.min(16384, generationModels.find(m => m.id === modelId)?.maxTokens || 16384)
  const initial = session || emptyRehearsalSession()
  const [intent, setIntent] = useState(initial.intent)
  const [constraints, setConstraints] = useState(initial.constraints)
  const [director, setDirector] = useState(initial.director)
  const [input, setInput] = useState<RehearsalInput | null>(initial.input)
  const [directions, setDirections] = useState<RehearsalDirection[]>(initial.directions)
  const [selected, setSelected] = useState(initial.selected)
  const [scenes, setScenes] = useState<Record<number, RehearsalScene>>(initial.scenes)
  const [previousScenes, setPreviousScenes] = useState(initial.previousScenes)
  const [previousResult, setPreviousResult] = useState<RehearsalResult | null>(initial.previousResult)
  const [step, setStep] = useState(initial.directions.length ? 2 : 1)
  const [busy, setBusy] = useState<'directions' | 'scene' | null>(null)
  const [received, setReceived] = useState(0)
  const [reviewing, setReviewing] = useState(false)
  const [formatRetry, setFormatRetry] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [invalidated, setInvalidated] = useState(false)
  const active = useRef<AbortController | null>(null)
  const direction = directions[selected]
  const scene = scenes[selected]
  const stale = !!input && (intent !== input.intent || constraints !== input.constraints)
  const directorChanged = !!scene && scene.director !== (director.trim() || t('rehearsal.directorDefault'))
  useEffect(() => {
    onSessionChange({ intent, constraints, director, input, directions, selected, scenes, previousScenes, previousResult })
  }, [intent, constraints, director, input, directions, selected, scenes, previousScenes, previousResult, onSessionChange])

  const errorText = (cause: unknown) => {
    const message = cause instanceof Error ? cause.message : String(cause)
    const key = `rehearsal.errors.${message}`
    return i18n.exists(key, { ns: 'editors' }) ? t(key) : t('rehearsal.errors.generic', { message })
  }

  useEffect(() => {
    void useLLMStore.getState().init().catch(() => {})
    const unsubscribe = useProjectStore.subscribe(state => {
      if (state.loading || state.currentProject?.id !== project.id || state.currentProject?.path !== project.path) {
        active.current?.abort()
        active.current = null
        setBusy(null)
        setInvalidated(true)
      }
    })
    return () => {
      unsubscribe()
      active.current?.abort()
      active.current = null
    }
  }, [project.id, project.path])

  const stop = () => {
    const wasRunning = !!active.current
    active.current?.abort()
    active.current = null
    setBusy(null)
    if (wasRunning) setNotice(t('rehearsal.cancelled'))
  }

  const restoreResult = () => {
    if (!previousResult) return
    const current = { input, directions, selected, scenes, previousScenes }
    setInput(previousResult.input)
    setDirections(previousResult.directions)
    setSelected(previousResult.selected)
    setScenes(previousResult.scenes)
    setPreviousScenes(previousResult.previousScenes)
    setIntent(previousResult.input?.intent || '')
    setConstraints(previousResult.input?.constraints || '')
    setPreviousResult(current)
    setError('')
    setStep(2)
  }

  const run = async (kind: 'directions' | 'scene') => {
    if (active.current || invalidated || (kind === 'scene' && stale)) return
    const controller = new AbortController()
    active.current = controller
    setBusy(kind)
    setReceived(0)
    setReviewing(false)
    setFormatRetry(false)
    setError('')
    setNotice('')
    const isCurrent = () => active.current === controller && !controller.signal.aborted
    try {
      if (!modelId) throw new Error('NO_MODEL')
      if (kind === 'directions') {
        // Capture local, possibly unsaved blueprint edits before any asynchronous work.
        const original = structuredClone(blueprint)
        const context = await ipc.invoke('db:rehearsal-context', project.path, original.chapterNumber)
        if (!isCurrent()) return
        const next: RehearsalInput = {
          intent, constraints, language: i18n.resolvedLanguage || i18n.language || 'zh-CN',
          blueprint: original, context,
        }
        const parsed = await generateRehearsalDirections(next,
          messages => streamRehearsal(messages, modelId, controller.signal,
            chunk => { if (isCurrent()) setReceived(n => n + chunk.length) }, { structured: true, maxTokens }),
          () => { if (isCurrent()) { setReviewing(true); setFormatRetry(false); setReceived(0) } },
          () => { if (isCurrent()) { setFormatRetry(true); setReceived(0) } })
        if (!isCurrent()) return
        if (input) setPreviousResult({ input, directions, selected, scenes, previousScenes })
        setInput(next)
        setDirections(parsed)
        setSelected(0)
        setScenes({})
        setPreviousScenes({})
        setStep(2)
      } else {
        if (!input || !direction) return
        const sceneDirector = director.trim() || t('rehearsal.directorDefault')
        const text = await streamRehearsal(buildRehearsalSceneMessages(input, direction, sceneDirector), modelId,
          controller.signal, chunk => { if (isCurrent()) setReceived(n => n + chunk.length) }, { maxTokens })
        if (!isCurrent()) return
        const clean = cleanRehearsalText(text)
        if (!clean || clean.length > 12000) throw new Error('INVALID_RESPONSE')
        if (scene) setPreviousScenes(prev => ({ ...prev, [selected]: scene }))
        setScenes(prev => ({ ...prev, [selected]: { text: clean, director: sceneDirector } }))
        setStep(3)
      }
    } catch (cause) {
      if (isCurrent()) setError(errorText(cause))
    } finally {
      if (active.current === controller) {
        active.current = null
        setBusy(null)
      }
    }
  }

  const adopt = () => {
    if (!input || !direction || invalidated || busy || stale) return
    const lines = [
      t('rehearsal.guidanceTitle', { title: direction.title }),
      `${t('rehearsal.intent')}: ${input.intent}`,
      `${t('rehearsal.constraints')}: ${input.constraints || t('rehearsal.none')}`,
      ...DIRECTION_FIELDS.map(key => `${t(`rehearsal.fields.${key}`)}: ${direction[key]}`),
      `${t('rehearsal.director')}: ${director.trim() || t('rehearsal.directorDefault')}`,
      t('rehearsal.proposalBoundary'),
    ]
    if (onAdopt(lines.join('\n'), input.blueprint)) {
      setInput({ ...input, blueprint: appendRehearsalGuidance(input.blueprint, lines.join('\n')) })
      onClose()
    }
    else setError(t('rehearsal.errors.BLUEPRINT_CHANGED'))
  }

  return (
    <Dialog open={isOpen} onOpenChange={open => { if (!open) { stop(); onClose() } }}>
      <DialogContent className="max-w-5xl w-[calc(100%-2rem)] h-[90vh] flex flex-col overflow-hidden" aria-busy={!!busy}
        onPointerDownOutside={event => event.preventDefault()}>
        <DialogHeader className="shrink-0 pr-12">
          <DialogTitle className="flex items-center gap-2"><GitBranch size={18} />{t('rehearsal.title')}</DialogTitle>
          <DialogDescription className="mt-1">{t('rehearsal.subtitle', { chapter: blueprint.chapterNumber })}</DialogDescription>
        </DialogHeader>
        <nav aria-label={t('rehearsal.steps')} className="grid grid-cols-3 gap-1 p-2 border-b border-[var(--color-border)] shrink-0">
          {[1, 2, 3].map(value => <button type="button" key={value} aria-current={step === value ? 'step' : undefined}
            disabled={!!busy || (value > 1 && !directions.length)} onClick={() => setStep(value)}
            className={`rounded-lg px-2 py-3 text-sm disabled:opacity-40 ${step === value ? 'bg-[var(--color-active)] text-[var(--color-accent)] font-semibold' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-hover)]'}`}>
            {value}. {t(`rehearsal.step${value}`)}
          </button>)}</nav>
        <div className="overflow-y-auto min-h-0 flex-1 p-5 space-y-4 text-sm text-[var(--color-text)]">
          <div hidden={step !== 1} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="rehearsal-intent">{t('rehearsal.intent')}</Label>
              <Textarea id="rehearsal-intent" value={intent} maxLength={3000} rows={3} disabled={!!busy || invalidated}
                placeholder={t('rehearsal.intentPlaceholder')}
                onChange={e => setIntent(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="rehearsal-constraints">{t('rehearsal.constraints')}</Label>
              <Textarea id="rehearsal-constraints" value={constraints} maxLength={3000} rows={3} disabled={!!busy || invalidated}
                placeholder={t('rehearsal.constraintsPlaceholder')}
                onChange={e => setConstraints(e.target.value)} />
            </div>
          </div>
          <div className="flex flex-wrap gap-3 items-end">
            <div className="min-w-0 flex-1">
              <Label htmlFor="rehearsal-model">{t('rehearsal.model')}</Label>
              <NativeSelect id="rehearsal-model" value={modelId} disabled={!!busy || invalidated} onChange={e => setModelChoice(e.target.value)}>
                {!generationModels.length && <option value="">{t('rehearsal.noModel')}</option>}
                {generationModels.map(m => <option value={m.id} key={m.id}>{m.name}</option>)}
              </NativeSelect>
            </div>
            <Button variant="ai" size="lg" disabled={!!busy || invalidated || !intent.trim() || !modelId} onClick={() => void run('directions')}>
              <GitBranch size={15} />{t(directions.length ? 'rehearsal.regenerate' : 'rehearsal.generate')}
            </Button>
          </div>
          <p className="text-xs text-[var(--color-text-muted)]">{t('rehearsal.contextHint')}</p>
          {!intent.trim() && <p className="text-sm text-[var(--color-text-secondary)]">{t('rehearsal.startHint')}</p>}
          {previousResult && <Button variant="outline" disabled={!!busy} onClick={restoreResult}>{t('rehearsal.restoreResult')}</Button>}
          </div>
          {stale && <div role="status" className="rounded-lg border border-[var(--color-accent)] p-3 space-y-2">
            <p>{t('rehearsal.stale')}</p>
            <Button variant="outline" onClick={() => { setIntent(input!.intent); setConstraints(input!.constraints) }}>{t('rehearsal.restoreInput')}</Button>
          </div>}
          {directions.length > 0 && step > 1 && <>
            <div className="grid gap-2 sm:grid-cols-3" aria-label={t('rehearsal.choices')}>
              {directions.map((item, index) => <button key={index} type="button" aria-pressed={selected === index}
                disabled={!!busy || invalidated} onClick={() => { setSelected(index); setNotice(''); setError('') }}
                className={`rounded-lg border p-3 text-left break-words transition-colors disabled:opacity-50 ${selected === index ? 'border-[var(--color-accent)] bg-[var(--color-active)]' : 'border-[var(--color-border)] hover:bg-[var(--color-hover)]'}`}>
                <span className="block font-medium">{index + 1}. {item.title}</span>
                <span className="block mt-1 text-xs leading-relaxed text-[var(--color-text-secondary)]">{item.premise}</span>
                <span className="block mt-2 text-xs leading-relaxed">{t('rehearsal.fields.cost')}: {item.cost}</span>
              </button>)}
            </div>
            {step === 2 && direction && <dl className="grid gap-4 sm:grid-cols-2 rounded-lg border border-[var(--color-border)] p-5">
              {DIRECTION_FIELDS.filter(key => key !== 'premise').map(key => <div key={key} className="min-w-0">
                <dt className="font-medium text-xs text-[var(--color-text-muted)]">{t(`rehearsal.fields.${key}`)}</dt>
                <dd className="mt-1 whitespace-pre-wrap break-words leading-relaxed">{direction[key]}</dd>
              </div>)}
            </dl>}
            <div>
              <Label htmlFor="rehearsal-director">{t('rehearsal.director')}</Label>
              <Textarea id="rehearsal-director" value={director} maxLength={1500} rows={2} disabled={!!busy || invalidated}
                placeholder={t('rehearsal.directorDefault')} onChange={e => setDirector(e.target.value)} />
            </div>
            {step === 3 && !scene && <p className="rounded-lg border border-dashed border-[var(--color-border)] p-6 text-[var(--color-text-secondary)]">{t('rehearsal.sceneEmpty')}</p>}
            {step === 3 && scene && <section aria-label={t('rehearsal.scene')} className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 justify-between">
                <Label htmlFor="rehearsal-scene">{t('rehearsal.scene')}</Label>
                {previousScenes[selected] && <Button variant="outline" disabled={!!busy} onClick={() => {
                  setScenes(prev => ({ ...prev, [selected]: previousScenes[selected] }))
                  setPreviousScenes(prev => ({ ...prev, [selected]: scene }))
                }}>{t('rehearsal.restoreScene')}</Button>}
                <Button variant="ghost" onClick={() => {
                  void navigator.clipboard.writeText(scene.text).then(() => setNotice(t('rehearsal.copied')),
                    () => setError(t('rehearsal.copyFailed')))
                }}>{t('rehearsal.copy')}</Button>
              </div>
              <p className="text-xs text-[var(--color-text-muted)] break-words">{t('rehearsal.sceneUsedDirector', { director: scene.director })}</p>
              {directorChanged && <p role="status" className="text-[var(--color-accent)]">{t('rehearsal.directorChanged')}</p>}
              <Textarea id="rehearsal-scene" value={scene.text} rows={10} disabled={!!busy || invalidated}
                className="text-base leading-8 min-h-64"
                onChange={e => setScenes(prev => ({ ...prev, [selected]: { ...scene, text: e.target.value } }))} />
            </section>}
          </>}
          {input && <details className="text-xs text-[var(--color-text-secondary)]">
            <summary className="cursor-pointer">{t('rehearsal.sources')}</summary>
            <p className="my-2">{t('rehearsal.sourcesHint')}</p>
            {!input.context.previousExcerpts.length && <p>{t('rehearsal.noHistory')}</p>}
            {input.context.previousExcerpts.map(excerpt => <div key={excerpt.draftId} className="my-3">
              <p className="font-medium">{t('rehearsal.excerpt', { chapter: excerpt.chapterNumber, version: excerpt.version })}{excerpt.truncated ? ` · ${t('rehearsal.excerptTail')}` : ''}</p>
              <p className="mt-1 whitespace-pre-wrap break-words leading-relaxed">{excerpt.text}</p>
            </div>)}
            <details className="mt-3">
              <summary className="cursor-pointer">{t('rehearsal.authorPlan')}{input.context.planTruncated ? ` · ${t('rehearsal.truncated')}` : ''}</summary>
              <dl className="mt-2 space-y-2">
                {Object.entries(input.context.authorPlan).filter(([, value]) => value).map(([key, value]) => <div key={key}>
                  <dt className="font-medium">{t(`rehearsal.planFields.${key}`)}</dt>
                  <dd className="mt-1 whitespace-pre-wrap break-words">{value}</dd>
                </div>)}
              </dl>
            </details>
          </details>}
        </div>
        <footer className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-sidebar)] px-5 py-3 space-y-2">
          {invalidated && <p role="alert" className="text-sm text-[var(--color-error)]">{t('rehearsal.errors.PROJECT_CHANGED')}</p>}
          {error && <p role="alert" className="text-sm text-[var(--color-error)] break-words">{error}</p>}
          {notice && <p role="status" className="text-sm text-[var(--color-accent)]">{notice}</p>}
          {busy ? <div className="flex flex-wrap items-center gap-2 text-sm" role="status">
            <LoaderCircle size={15} className="animate-spin" />
            <span className="flex-1">{t(formatRetry ? 'rehearsal.formatRetry' : reviewing ? 'rehearsal.reviewing' : 'rehearsal.generating', { count: received })}</span>
            <Button variant="outline" onClick={stop}>{t('rehearsal.cancel')}</Button>
          </div> : <div className="flex flex-wrap gap-2 items-center justify-between">
            <p className="text-xs text-[var(--color-text-secondary)] flex-1 min-w-40">{t(directions.length ? 'rehearsal.adoptHint' : 'rehearsal.sessionHint')}</p>
            {directions.length > 0 && <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={invalidated || stale || !modelId} onClick={() => void run('scene')}>
                <PenLine size={14} />{t(scene ? 'rehearsal.rewriteScene' : 'rehearsal.writeScene')}
              </Button>
              <Button disabled={invalidated || stale} onClick={adopt}>{t('rehearsal.adopt')}</Button>
            </div>}
          </div>}
        </footer>
      </DialogContent>
    </Dialog>
  )
}
