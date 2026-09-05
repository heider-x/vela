import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenAIProvider } from '../llm/openai-provider'
import type { ModelProfile } from '../../src/shared/ipc-channels'

afterEach(() => vi.unstubAllGlobals())
const model: ModelProfile = {
  id: 'fixture', name: 'fixture', provider: 'ollama', protocol: 'openai', modelName: 'test',
  apiKey: '', baseUrl: 'http://localhost:11434/v1', temperature: 0.8, maxTokens: 100, purposes: ['generation'],
}

describe('explicit thinking control for rehearsal requests', () => {
  it('rejects streamed output stopped by the token limit instead of completing it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      'data: {"choices":[{"delta":{"content":"{\\"directions\\":[]}"}}]}\n\n' +
      'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n',
    )))
    const done = vi.fn(), error = vi.fn()
    await new OpenAIProvider().generateStream(model, [], {
      temperature: 0.7, maxTokens: 100, thinking: false, signal: new AbortController().signal,
      onChunk: vi.fn(), onDone: done, onError: error,
    })
    expect(done).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('长度上限'))
  })

  it('strips an orphan thinking prefix split across streamed chunks', async () => {
    const events = ['Internal deliberation</thi', 'nk>```json\n{"directions":[]}\n```']
      .map(content => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`).join('')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(events + 'data: [DONE]\n\n')))
    const done = vi.fn()
    await new OpenAIProvider().generateStream(model, [], {
      temperature: 0.7, maxTokens: 100, thinking: false, signal: new AbortController().signal,
      onChunk: vi.fn(), onDone: done, onError: vi.fn(),
    })
    expect(done).toHaveBeenCalledExactlyOnceWith('```json\n{"directions":[]}\n```')
  })

  it('does not request unsupported structured output from an Ollama cloud model', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] })))
    vi.stubGlobal('fetch', fetchMock)
    await new OpenAIProvider().generate({ ...model, modelName: 'glm-5.3-flash:cloud' }, [], { temperature: 0.7, maxTokens: 100, responseFormat: { type: 'json_object' } })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).not.toHaveProperty('response_format')
  })
  it('does not expose or accept a response cut off by the output limit', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '{"message":"半截' } }] }))))
    const result = await new OpenAIProvider().generate(model, [], { thinking: false, temperature: 0.7, maxTokens: 100 })
    expect(result.success).toBe(false)
    expect(result.content).toBe('')
    expect(result.error).toContain('结果不完整')
  })
  it('removes an orphan closing thinking delimiter returned by a cloud adapter', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'Internal reasoning...</think>{"message":"读取章节","toolCall":{"name":"list_chapters","arguments":{}}}' } }] }))))
    const result = await new OpenAIProvider().generate(model, [], { thinking: false, temperature: 0.7, maxTokens: 100 })
    expect(JSON.parse(result.content).toolCall.name).toBe('list_chapters')
    expect(result.content).not.toContain('Internal reasoning')
  })
  it.each(['ollama', 'deepseek', 'openai'] as const)('maps false correctly in %s streaming requests', async provider => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'))
    vi.stubGlobal('fetch', fetchMock)
    const done = vi.fn()
    await new OpenAIProvider().generateStream({ ...model, provider }, [], {
      temperature: 0.8, maxTokens: 100, thinking: false, signal: new AbortController().signal,
      onChunk: vi.fn(), onDone: done, onError: vi.fn(),
    })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    if (provider === 'ollama') expect(body.reasoning_effort).toBe('none')
    if (provider === 'deepseek') expect(body.thinking).toEqual({ type: 'disabled' })
    if (provider === 'openai') {
      expect(body).not.toHaveProperty('thinking')
      expect(body).not.toHaveProperty('reasoning_effort')
    }
    expect(done.mock.calls[0][0]).toBe('ok')
  })

  it('also respects explicit false in non-streaming generation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] })))
    vi.stubGlobal('fetch', fetchMock)
    await new OpenAIProvider().generate(model, [], { temperature: 0.8, maxTokens: 100, thinking: false })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).reasoning_effort).toBe('none')
  })
})
