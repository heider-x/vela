export function ollamaTagsUrl(baseUrl: string): string {
  let url: URL
  try { url = new URL(baseUrl.trim()) } catch { throw new Error('INVALID_URL') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('INVALID_URL')
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/(?:v1|api)$/, '') + '/api/tags'
  return url.toString()
}

export async function listOllamaModels(baseUrl: string, apiKey = ''): Promise<string[]> {
  const response = await fetch(ollamaTagsUrl(baseUrl), {
    method: 'GET', redirect: 'error', signal: AbortSignal.timeout(8000),
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
  })
  if (!response.ok) throw new Error(`HTTP_${response.status}`)
  const data: unknown = await response.json()
  if (!data || typeof data !== 'object' || !('models' in data) || !Array.isArray(data.models)) throw new Error('INVALID_RESPONSE')
  const names = data.models.map((item: unknown) => {
    if (!item || typeof item !== 'object' || !('name' in item) || typeof item.name !== 'string' || !item.name.trim()) throw new Error('INVALID_RESPONSE')
    return item.name
  })
  return [...new Set(names)].sort((a, b) => a.localeCompare(b))
}
