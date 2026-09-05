import { ipc } from './ipc-client'
import type { RehearsalMessages } from '../shared/story-rehearsal'

/** A request owns its listeners, timeout and cancellation, including late IPC acknowledgement. */
export function streamRehearsal(
  messages: RehearsalMessages,
  modelId: string,
  signal: AbortSignal,
  onChunk: (text: string) => void,
  options: { structured?: boolean; maxTokens?: number } = {},
): Promise<string> {
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'))
  if (!modelId) return Promise.reject(new Error('NO_MODEL'))
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID()
    const listeners: Array<() => void> = []
    let settled = false
    let cancelled = false
    let received = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const cancel = () => { void ipc.invoke('llm:cancel', requestId).catch(() => {}) }
    const finish = (error?: Error, text = '') => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      listeners.forEach(unsubscribe => unsubscribe())
      if (error) reject(error)
      else resolve(text)
    }
    const abort = () => {
      cancelled = true
      finish(new DOMException('Aborted', 'AbortError'))
      cancel()
    }
    try {
      listeners.push(ipc.on('llm:stream-chunk', data => {
        if (data.requestId !== requestId || settled) return
        received += data.chunk.length
        if (received > 160000) {
          cancelled = true
          finish(new Error('INVALID_RESPONSE'))
          cancel()
        } else onChunk(data.chunk)
      }))
      listeners.push(ipc.on('llm:stream-done', data => {
        if (data.requestId === requestId) finish(undefined, data.fullText)
      }))
      listeners.push(ipc.on('llm:stream-error', data => {
        if (data.requestId === requestId) finish(new Error(data.error || 'GENERATION_FAILED'))
      }))
      signal.addEventListener('abort', abort, { once: true })
      timer = setTimeout(() => {
        cancelled = true
        finish(new Error('GENERATION_TIMEOUT'))
        cancel()
      }, 180000)
      if (signal.aborted) { abort(); return }
      void ipc.invoke('llm:generate-stream', requestId, {
        modelId, messages, maxTokens: options.maxTokens ?? 16384, thinking: false,
        ...(options.structured ? { responseFormat: { type: 'json_object' } } : {}),
      })
        .then(result => {
          if (cancelled) cancel()
          if (!result?.started) finish(new Error('NO_MODEL'))
        }).catch(error => finish(error instanceof Error ? error : new Error(String(error))))
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)))
    }
  })
}
