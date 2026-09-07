import { afterEach, describe, expect, it, vi } from 'vitest'
import http from 'node:http'
import { listOllamaModels, ollamaTagsUrl } from '../llm/ollama-models'

afterEach(() => vi.unstubAllGlobals())
describe('Ollama installed model discovery', () => {
  it.each([
    ['http://localhost:11434', 'http://localhost:11434/api/tags'],
    ['http://localhost:11434/v1/', 'http://localhost:11434/api/tags'],
    ['https://example.com/ollama/api', 'https://example.com/ollama/api/tags'],
  ])('normalizes %s', (input, output) => expect(ollamaTagsUrl(input)).toBe(output))
  it.each(['file:///tmp/models', 'localhost:11434', 'https://u:p@example.com', 'http://localhost:11434?q=a'])('rejects invalid address %s', value => {
    expect(() => ollamaTagsUrl(value)).toThrow('INVALID_URL')
  })
  it('reads actual HTTP tags without downloading or generating, preserving model tags', async () => {
    const requests: string[] = []
    const server = http.createServer((req, res) => {
      requests.push(`${req.method} ${req.url}`)
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ models: [{ name: 'qwen3:8b' }, { name: 'nomic-embed-text:latest' }, { name: 'qwen3:8b' }] }))
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address() as { port: number }
      expect(await listOllamaModels(`http://127.0.0.1:${address.port}/v1`)).toEqual(['nomic-embed-text:latest', 'qwen3:8b'])
      expect(requests).toEqual(['GET /api/tags'])
    } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
  })
  it('distinguishes empty lists, invalid responses, and HTTP failures', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ models: [] })))
    expect(await listOllamaModels('http://localhost:11434')).toEqual([])
    fetch.mockResolvedValueOnce(new Response(JSON.stringify({ data: [] })))
    await expect(listOllamaModels('http://localhost:11434')).rejects.toThrow('INVALID_RESPONSE')
    fetch.mockResolvedValueOnce(new Response('', { status: 401 }))
    await expect(listOllamaModels('http://localhost:11434')).rejects.toThrow('HTTP_401')
  })
})
