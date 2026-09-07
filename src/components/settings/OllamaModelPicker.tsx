import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ipc } from '../../services/ipc-client'
import type { ModelProfile } from '../../shared/ipc-channels'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Label } from '../ui/Label'
import { NativeSelect } from '../ui/NativeSelect'

export default function OllamaModelPicker({ model, onChange }: { model: ModelProfile; onChange: (model: ModelProfile) => void }) {
  const { t } = useTranslation('settings')
  const id = useId()
  const sequence = useRef({ value: 0 })
  const [names, setNames] = useState<string[]>([])
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [error, setError] = useState('')
  const [source, setSource] = useState('')
  const serverKey = `${model.baseUrl}\n${model.apiKey}`
  const currentNames = source === serverKey ? names : []
  const currentStatus = source === serverKey ? status : 'idle'
  const refresh = useCallback(async () => {
    const request = ++sequence.current.value
    setNames([])
    setStatus('loading')
    setSource(`${model.baseUrl}\n${model.apiKey}`)
    setError('')
    try {
      const result = await ipc.invoke('llm:ollama-models', model.baseUrl, model.apiKey)
      if (request !== sequence.current.value) return
      if (!result.success) throw new Error(result.error || 'CONNECTION_FAILED')
      setNames(result.models)
      setStatus('ready')
    } catch (cause) {
      if (request !== sequence.current.value) return
      setError(cause instanceof Error ? cause.message : 'CONNECTION_FAILED')
      setStatus('error')
    }
  }, [model.baseUrl, model.apiKey])
  useEffect(() => {
    const tracker = sequence.current
    ++tracker.value
    const timer = setTimeout(() => { void refresh() }, 450)
    return () => { clearTimeout(timer); ++tracker.value }
  }, [refresh])
  const choose = (value: string) => onChange({ ...model, modelName: value, name: !model.name || model.name === model.modelName ? value : model.name })
  return <div className="space-y-2 rounded-lg border border-[var(--color-border)] p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Label htmlFor={`${id}-select`}>{t('models.ollamaInstalled')}</Label>
      <Button size="sm" variant="outline" disabled={currentStatus === 'loading' || !model.baseUrl.trim()} onClick={() => void refresh()}>
        <RefreshCw size={13} className={currentStatus === 'loading' ? 'animate-spin' : ''} />{t('models.ollamaRefresh')}
      </Button>
    </div>
    <div className="relative">
    <NativeSelect id={`${id}-select`} className="pr-9 h-9" value={currentNames.includes(model.modelName) ? model.modelName : ''}
      disabled={currentStatus !== 'ready' || !currentNames.length} onChange={e => choose(e.target.value)}>
      <option value="" disabled>{t('models.ollamaSelect')}</option>
      {currentNames.map(name => <option key={name} value={name}>{name}</option>)}
    </NativeSelect>
    <ChevronDown size={16} aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-text-secondary)]" />
    </div>
    <p role="status" className="text-xs text-[var(--color-text-secondary)] break-words">
      {currentStatus === 'loading' ? t('models.ollamaLoading') : currentStatus === 'ready' ? t(names.length ? 'models.ollamaCount' : 'models.ollamaEmpty', { count: names.length }) : t('models.ollamaHint')}
    </p>
    {currentStatus === 'error' && <p role="alert" className="text-xs text-[var(--color-error)] break-words">{t('models.ollamaFailed', { error })}</p>}
    <Label htmlFor={`${id}-manual`}>{t('models.ollamaIdentifier')}</Label>
    <Input id={`${id}-manual`} value={model.modelName} onChange={e => choose(e.target.value)} placeholder="qwen3:8b" />
  </div>
}
