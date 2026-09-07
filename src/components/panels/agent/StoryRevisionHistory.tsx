import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../../ui/Dialog'
import { Button } from '../../ui/Button'
import { useProjectStore } from '../../../stores/project-store'
import { useAgentStore } from '../../../stores/agent-store'
import { ipc } from '../../../services/ipc-client'
import { undoRevision } from '../../../services/agent/story-revision-service'
import type { StoryRevision } from '../../../shared/story-revision'

export default function StoryRevisionHistory() {
  const { t } = useTranslation('panels')
  const projectPath = useProjectStore(s => s.currentProject?.path)
  const close = useAgentStore(s => s.setShowStoryHistory)
  const generating = useAgentStore(s => s.generating)
  const [entries, setEntries] = useState<StoryRevision[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    if (projectPath) ipc.invoke('story:history', projectPath).then(rows => { if (active) setEntries(rows) }).catch(e => { if (active) setError(String(e)) })
    return () => { active = false }
  }, [projectPath])
  const undo = async (id: string) => {
    if (!projectPath) return
    setBusy(true); setError('')
    try {
      await undoRevision(projectPath, id)
      const rows = await ipc.invoke('story:history', projectPath)
      if (useProjectStore.getState().currentProject?.path === projectPath) setEntries(rows)
    } catch (e) { setError(String(e)) } finally { setBusy(false) }
  }
  return <Dialog open onOpenChange={open => { if (!open) close(false) }}>
    <DialogContent className="max-w-3xl">
      <DialogHeader><DialogTitle>{t('storyRevision.history')}</DialogTitle><DialogDescription>{t('storyRevision.description')}</DialogDescription></DialogHeader>
      <div className="px-5 pb-5 overflow-y-auto max-h-[70vh] space-y-4">
        {error && <p role="alert" className="text-sm text-[var(--color-error)] whitespace-pre-wrap">{error}</p>}
        {!entries.length && !error && <p className="text-sm text-[var(--color-text-muted)]">{t('storyRevision.empty')}</p>}
        {entries.map(entry => <article key={entry.id} className="border border-[var(--color-border)] rounded-lg p-4 space-y-3">
          <div className="flex justify-between gap-4 items-start">
            <div><p className="font-medium text-sm">{entry.intent}</p><p className="text-xs text-[var(--color-text-muted)] mt-1">{new Date(entry.createdAt).toLocaleString()} · {t(entry.status === 'undone' ? 'storyRevision.undone' : 'storyRevision.applied')}</p></div>
            <Button variant="outline" disabled={entry.status === 'undone' || busy || generating} onClick={() => void undo(entry.id)}>{t('storyRevision.undo')}</Button>
          </div>
          <details className="text-sm"><summary className="cursor-pointer text-[var(--color-text-secondary)]">{t('storyRevision.impact')}</summary><p className="mt-2 whitespace-pre-wrap leading-relaxed">{entry.summary}</p></details>
          {entry.changes.map((change, index) => <details key={index} className="text-sm">
            <summary className="cursor-pointer py-1">{change.title} · {change.field === 'characters' ? t('storyRevision.participants') : t(`storyRevision.fields.${change.field}`, { defaultValue: change.field })}</summary>
            <div className="grid md:grid-cols-2 gap-3 mt-2">
              <div><p className="text-xs text-[var(--color-text-muted)] mb-1">{t('storyRevision.before')}</p><pre className="whitespace-pre-wrap break-words text-xs leading-6 p-3 bg-[var(--color-panel)] rounded max-h-80 overflow-y-auto">{change.before || '—'}</pre></div>
              <div><p className="text-xs text-[var(--color-accent)] mb-1">{t('storyRevision.after')}</p><pre className="whitespace-pre-wrap break-words text-xs leading-6 p-3 bg-[var(--color-panel)] rounded max-h-80 overflow-y-auto">{change.after || '—'}</pre></div>
            </div>
          </details>)}
        </article>)}
      </div>
    </DialogContent>
  </Dialog>
}
