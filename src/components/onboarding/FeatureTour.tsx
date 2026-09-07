import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { ArrowLeft, ArrowRight, BookOpenCheck, Copy, GitBranch, ListTree, Sparkles, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { hasSeenFeatureTour, useOnboardingStore } from '../../stores/onboarding-store'
import { useLayoutStore } from '../../stores/layout-store'
import { useAgentStore } from '../../stores/agent-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import { Button } from '../ui/Button'

const steps = [
  { id: 'agent', targets: ['agent-input', 'agent-entry'], icon: Sparkles, example: true },
  { id: 'history', targets: ['revision-history', 'agent-entry'], icon: BookOpenCheck },
  { id: 'blueprints', targets: ['blueprints', 'project-entry'], icon: ListTree },
  { id: 'rehearsal', targets: ['rehearsal', 'blueprints', 'project-entry'], icon: GitBranch },
  { id: 'models', targets: ['model-settings'], icon: Sparkles },
] as const
type Bounds = { left: number; top: number; width: number; height: number }

/** First visit offers a short tour; existing dialogs and active writing take priority. */
export default function FeatureTour() {
  const open = useOnboardingStore(s => s.open)
  const dismissed = useOnboardingStore(s => s.dismissedThisSession)
  const modalOpen = useLayoutStore(s => s.settingsOpen || s.newProjectOpen || s.importNovelOpen || s.exportOpen || s.chapterCreationOpen)
  const generating = useAgentStore(s => s.generating)
  const workflowBusy = useWorkflowStore(s => s.activeRuns.length > 0)
  const offered = useRef(false)
  useEffect(() => {
    if (open || dismissed || modalOpen || generating || workflowBusy || offered.current || hasSeenFeatureTour()) return
    const timer = setTimeout(() => {
      if (document.querySelector('[role="dialog"]')) return
      offered.current = true
      useOnboardingStore.getState().start()
    }, 1100)
    return () => clearTimeout(timer)
  }, [open, dismissed, modalOpen, generating, workflowBusy])
  return open ? <TourBubbles /> : null
}

function TourBubbles() {
  const { t } = useTranslation('layout')
  const dismiss = useOnboardingStore(s => s.dismiss)
  const [index, setIndex] = useState(0)
  const [copied, setCopied] = useState('')
  const [anchor, setAnchor] = useState<Bounds | null>(null)
  const [viewport, setViewport] = useState({ width: innerWidth, height: innerHeight })
  const [size, setSize] = useState({ width: 410, height: 430 })
  const contentRef = useRef<HTMLDivElement>(null)
  const step = steps[index]
  const Icon = step.icon

  // Measure real visible targets. Missing panels fall back to a related entry or the centre.
  // No tab navigation, data writes, model calls or input replacement occur during the tour.
  useLayoutEffect(() => {
    let frame = 0
    const measure = () => {
      let bounds: Bounds | null = null
      for (const name of step.targets) {
        const element = document.querySelector<HTMLElement>(`[data-tour="${name}"]`)
        if (!element) continue
        const rect = element.getBoundingClientRect()
        if (getComputedStyle(element).visibility === 'hidden' || rect.width < 1 || rect.height < 1 || rect.bottom < 0 || rect.right < 0 || rect.top > innerHeight || rect.left > innerWidth) continue
        const left = Math.max(4, rect.left - 4), top = Math.max(4, rect.top - 4)
        bounds = { left, top, width: Math.min(innerWidth - 4, rect.right + 4) - left, height: Math.min(innerHeight - 4, rect.bottom + 4) - top }
        break
      }
      setAnchor(previous => JSON.stringify(previous) === JSON.stringify(bounds) ? previous : bounds)
      setViewport(previous => previous.width === innerWidth && previous.height === innerHeight ? previous : { width: innerWidth, height: innerHeight })
      const rect = contentRef.current?.getBoundingClientRect()
      if (rect) setSize(previous => previous.width === rect.width && previous.height === rect.height ? previous : { width: rect.width, height: rect.height })
    }
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure) }
    const resize = new ResizeObserver(schedule)
    resize.observe(document.documentElement)
    if (contentRef.current) resize.observe(contentRef.current)
    for (const target of step.targets) {
      const element = document.querySelector(`[data-tour="${target}"]`)
      if (element) resize.observe(element)
    }
    const mutations = new MutationObserver(schedule)
    mutations.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    schedule()
    return () => {
      cancelAnimationFrame(frame)
      resize.disconnect()
      mutations.disconnect()
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
    }
  }, [step])

  const width = Math.min(410, viewport.width - 24)
  const height = Math.min(size.height, viewport.height - 24)
  let left = (viewport.width - width) / 2, top = (viewport.height - height) / 2
  let side: 'left' | 'right' | 'top' | 'bottom' | null = null
  if (anchor) {
    if (anchor.left >= width + 28) {
      left = anchor.left - width - 16; top = anchor.top + anchor.height / 2 - height / 2; side = 'right'
    } else if (viewport.width - anchor.left - anchor.width >= width + 28) {
      left = anchor.left + anchor.width + 16; top = anchor.top + anchor.height / 2 - height / 2; side = 'left'
    } else if (viewport.height - anchor.top - anchor.height >= height + 28) {
      left = anchor.left + anchor.width / 2 - width / 2; top = anchor.top + anchor.height + 16; side = 'top'
    } else if (anchor.top >= height + 28) {
      left = anchor.left + anchor.width / 2 - width / 2; top = anchor.top - height - 16; side = 'bottom'
    }
  }
  left = Math.max(12, Math.min(left, viewport.width - width - 12))
  top = Math.max(12, Math.min(top, viewport.height - height - 12))
  const last = index === steps.length - 1
  const changeStep = (next: number) => { setCopied(''); setIndex(next) }
  const copy = async () => {
    try { await navigator.clipboard.writeText(t('featureTour.agent.example')); setCopied(t('featureTour.copied')) }
    catch { setCopied(t('featureTour.copyFailed')) }
  }

  return <Dialog.Root open onOpenChange={value => { if (!value) dismiss() }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[10000]" style={{ background: anchor ? 'transparent' : 'rgba(0,0,0,.42)' }} />
      {anchor && <div aria-hidden="true" data-tour-spotlight className="fixed pointer-events-none z-[10001] rounded-lg" style={{ ...anchor, border: '2px solid var(--color-accent)', boxShadow: '0 0 0 9999px rgba(0,0,0,.42), 0 0 20px rgba(126,200,227,.3)' }} />}
      <Dialog.Content ref={contentRef} data-tour-bubble className="fixed z-[10002] rounded-2xl outline-none text-[var(--color-text)]" style={{ left, top, width, maxHeight: viewport.height - 24, backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', boxShadow: '0 16px 55px rgba(0,0,0,.35)' }}
        onPointerDownOutside={event => event.preventDefault()}
        onCloseAutoFocus={event => { event.preventDefault(); document.querySelector<HTMLElement>('[data-tour="guide-entry"]')?.focus() }}>
        {side && <span aria-hidden="true" className="absolute w-3 h-3 rotate-45" style={{ backgroundColor: 'var(--color-bg)',
          ...(side === 'left' || side === 'right' ? { top: Math.max(24, Math.min(height - 36, anchor!.top + anchor!.height / 2 - top)), [side]: -6 } : { left: Math.max(24, Math.min(width - 36, anchor!.left + anchor!.width / 2 - left)), [side]: -6 }) }} />}
        <div className="relative overflow-y-auto rounded-2xl" style={{ maxHeight: viewport.height - 26 }}>
          <div className="px-6 pt-5 pb-4">
            <div className="flex items-center justify-between gap-3 mb-4">
              <span className="text-xs font-medium text-[var(--color-accent)]">{t('featureTour.label')} · {index + 1} / {steps.length}</span>
              <button aria-label={t('featureTour.skip')} title={t('featureTour.skip')} onClick={dismiss} className="p-1 rounded hover:bg-[var(--color-hover)] focus-visible:outline-2 focus-visible:outline-[var(--color-accent)]"><X size={16} /></button>
            </div>
            <div className="flex items-start gap-3 mb-3">
              <span className="flex shrink-0 w-10 h-10 items-center justify-center rounded-xl bg-[var(--color-hover)] text-[var(--color-accent)]"><Icon size={22} /></span>
              <Dialog.Title className="text-lg font-semibold leading-7">{t(`featureTour.${step.id}.title`)}</Dialog.Title>
            </div>
            <Dialog.Description className="text-sm leading-7 text-[var(--color-text-secondary)]">{t(`featureTour.${step.id}.description`)}</Dialog.Description>
            {step.id === 'agent' && <div className="mt-4 p-3.5 rounded-xl bg-[var(--color-hover)] border border-[var(--color-border)]">
              <p className="text-xs text-[var(--color-text-muted)] mb-2">{t('featureTour.exampleLabel')}</p>
              <blockquote className="text-sm leading-7 select-text">{t('featureTour.agent.example')}</blockquote>
              <Button variant="ghost" className="mt-2 -ml-1" onClick={() => void copy()}><Copy size={12} />{t('featureTour.copy')}</Button>
              <p role="status" className="text-xs text-[var(--color-accent)] leading-5">{copied}</p>
            </div>}
            <p className="mt-4 text-xs leading-6 text-[var(--color-text-muted)]">{t(`featureTour.${step.id}.hint`)}</p>
          </div>
          <div className="border-t border-[var(--color-border)] px-6 py-4">
            <div className="flex items-center justify-between gap-3">
              {index === 0 ? <Button variant="ghost" onClick={dismiss}>{t('featureTour.later')}</Button> : <Button variant="ghost" onClick={() => changeStep(index - 1)}><ArrowLeft size={13} />{t('featureTour.previous')}</Button>}
              <Button onClick={() => { if (last) { dismiss(); useLayoutStore.getState().openSettings() } else changeStep(index + 1) }}>
                {t(last ? 'featureTour.configure' : 'featureTour.next')}<ArrowRight size={13} />
              </Button>
            </div>
            {last ? <button onClick={dismiss} className="block mx-auto mt-3 text-xs underline underline-offset-4 text-[var(--color-text-secondary)]">{t('featureTour.finish')}</button>
              : <p className="mt-3 text-[11px] leading-5 text-[var(--color-text-muted)]">{t('featureTour.reopen')}</p>}
          </div>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}
