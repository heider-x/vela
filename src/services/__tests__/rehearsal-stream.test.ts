import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ipc } from '../ipc-client'
import { streamRehearsal } from '../rehearsal-stream'

vi.mock('../ipc-client', () => ({ ipc: { invoke: vi.fn(), on: vi.fn() } }))
const callbacks = new Map<string, (data: never) => void>()
let id = ''
function emit(event: string, payload: Record<string, unknown>) {
  callbacks.get(event)?.({ requestId: id, ...payload } as never)
}

beforeEach(() => {
  vi.useFakeTimers()
  callbacks.clear()
  vi.mocked(ipc.on).mockImplementation((channel, callback) => {
    callbacks.set(channel, callback as (data: never) => void)
    return () => callbacks.delete(channel)
  })
  vi.mocked(ipc.invoke).mockImplementation(async (channel, ...args) => {
    if (channel === 'llm:generate-stream') { id = args[0] as string; return { requestId: id, started: true } }
    return { success: true } as never
  })
})
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

describe('rehearsal stream lifetime', () => {
  it('requests enough output for directions without imposing JSON on trial prose', async () => {
    const plans = streamRehearsal([], 'model', new AbortController().signal, vi.fn(), { structured: true })
    expect(ipc.invoke).toHaveBeenCalledWith('llm:generate-stream', id, expect.objectContaining({
      maxTokens: 16384, thinking: false, responseFormat: { type: 'json_object' },
    }))
    emit('llm:stream-done', { fullText: '{}' })
    await plans
    const scene = streamRehearsal([], 'model', new AbortController().signal, vi.fn())
    const request = vi.mocked(ipc.invoke).mock.calls.at(-1)?.[2]
    expect(request).not.toHaveProperty('responseFormat')
    emit('llm:stream-done', { fullText: '正文' })
    await scene
  })

  it('ignores other requests and releases all listeners on completion', async () => {
    const chunk = vi.fn()
    const result = streamRehearsal([], 'model', new AbortController().signal, chunk)
    emit('llm:stream-chunk', { requestId: 'other', chunk: 'unrelated' })
    emit('llm:stream-chunk', { chunk: 'hello' })
    emit('llm:stream-done', { fullText: 'hello' })
    expect(await result).toBe('hello')
    expect(chunk).toHaveBeenCalledExactlyOnceWith('hello')
    expect(callbacks.size).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels again if startup acknowledgement arrives after abort', async () => {
    let acknowledge!: (value: { requestId: string; started: boolean }) => void
    vi.mocked(ipc.invoke).mockImplementation((channel, ...args) => {
      if (channel === 'llm:generate-stream') {
        id = args[0] as string
        return new Promise(resolve => { acknowledge = resolve }) as never
      }
      return Promise.resolve({ success: true }) as never
    })
    const controller = new AbortController()
    const result = streamRehearsal([], 'model', controller.signal, vi.fn())
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await rejected
    acknowledge({ requestId: id, started: true })
    await Promise.resolve()
    expect(vi.mocked(ipc.invoke).mock.calls.filter(call => call[0] === 'llm:cancel')).toHaveLength(2)
    expect(callbacks.size).toBe(0)
  })

  it('cleans up when startup rejects or the model no longer exists', async () => {
    vi.mocked(ipc.invoke).mockRejectedValueOnce(new Error('offline'))
    await expect(streamRehearsal([], 'model', new AbortController().signal, vi.fn())).rejects.toThrow('offline')
    expect(callbacks.size).toBe(0)
    vi.mocked(ipc.invoke).mockResolvedValueOnce({ started: false } as never)
    await expect(streamRehearsal([], 'model', new AbortController().signal, vi.fn())).rejects.toThrow('NO_MODEL')
    expect(callbacks.size).toBe(0)
  })

  it('terminates a silent request on timeout', async () => {
    const result = streamRehearsal([], 'model', new AbortController().signal, vi.fn())
    const rejected = expect(result).rejects.toThrow('GENERATION_TIMEOUT')
    await vi.advanceTimersByTimeAsync(180000)
    await rejected
    expect(ipc.invoke).toHaveBeenCalledWith('llm:cancel', id)
    expect(callbacks.size).toBe(0)
  })

  it('never starts an already-aborted request', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(streamRehearsal([], 'model', controller.signal, vi.fn())).rejects.toMatchObject({ name: 'AbortError' })
    expect(ipc.invoke).not.toHaveBeenCalled()
  })
})
