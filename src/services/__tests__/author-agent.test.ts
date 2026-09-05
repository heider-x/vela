import { afterEach, describe, expect, it, vi } from 'vitest'
import { runAgentLoop, parseToolCalls } from '../agent/agent-engine'
import { toolRegistry } from '../agent/tool-registry'
import { applyRevision, refreshAfterStoryRevision } from '../agent/story-revision-service'
import { startWorkflowTool } from '../agent/tools/start-workflow.tool'
import { builtinTools } from '../agent/tools'
import { storyRewriteDraftTool } from '../agent/tools/story-content.tool'
import { useProjectStore } from '../../stores/project-store'
import { useCharacterStore } from '../../stores/character-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import { useEditorStore } from '../../stores/editor-store'
import { useLLMStore } from '../../stores/llm-store'
import { ipc } from '../ipc-client'

afterEach(() => { toolRegistry.clear(); vi.restoreAllMocks() })
const callbacks = () => ({ onTextChunk: vi.fn(), onToolCallStart: vi.fn(), onToolCallComplete: vi.fn(), onToolCallConfirmRequired: vi.fn(), onDone: vi.fn(), onError: vi.fn() })
const call = '<tool_call>{"name":"fixture","arguments":{}}</tool_call>'
describe('author agent execution', () => {
  it.each(['继续执行方案A，先读取第一章后整章改写。', '收到，先完整读取第一章，再精确替换。'])('does not end on a promised action without a call: %s', async plan => {
    const execute = vi.fn(async () => ({ success: true, content: '原文' }))
    toolRegistry.register({ name: 'fixture', description: '', source: 'builtin', requiresConfirmation: false, isReadOnly: true, inputSchema: { type: 'object', properties: {} }, execute })
    const replies = [JSON.stringify({ message: plan, toolCall: null }), JSON.stringify({ message: '读取第一章', toolCall: { name: 'fixture', arguments: {} } }), JSON.stringify({ message: '检查已完成。', toolCall: null })]
    const cb = callbacks()
    await runAgentLoop('', [], '继续改写', 'model', async () => replies.shift()!, cb, undefined, undefined, true)
    expect(execute).toHaveBeenCalledOnce()
    expect(cb.onDone).toHaveBeenCalledOnce()
  })
  it('allows a discussion of editing steps to end without triggering work', async () => {
    const cb = callbacks()
    const generate = vi.fn(async () => JSON.stringify({ message: '第一步先读取正文，第二步再确定改写范围。', toolCall: null }))
    await runAgentLoop('', [], '现在只讨论修改步骤', 'model', generate, cb, undefined, undefined, true)
    expect(generate).toHaveBeenCalledOnce()
    expect(cb.onToolCallStart).not.toHaveBeenCalled()
  })
  it.each(['complete', 'incomplete', 'cancelled'] as const)('runs the requested rewrite internally and checks its %s result before saving', async mode => {
    useProjectStore.setState({ currentProject: { path: 'D:/novel', novelConfig: {} } as never, loading: false })
    useCharacterStore.setState({ loaded: false }); useEditorStore.setState({ tabs: [] }); useWorkflowStore.setState({ activeRuns: [] })
    useLLMStore.setState({ models: [{ id: 'model', maxTokens: 4096 }] as never })
    const controller = new AbortController()
    const invoke = vi.spyOn(ipc, 'invoke').mockImplementation(async (channel, ...args) => {
      if (channel === 'story:read') return { version: 'v1', content: (args[1] as { kind: string }).kind === 'draft' ? '我站在码头。' : '', nextOffset: null } as never
      if (channel === 'llm:generate') {
        expect((args[0] as { modelId: string }).modelId).toBe('model')
        if (mode === 'cancelled') controller.abort()
        return { success: true, content: mode === 'incomplete' ? '<vela_rewrite>半截正文' : '<vela_rewrite>林舟站在码头。</vela_rewrite>' } as never
      }
      if (channel === 'story:apply') {
        expect((args[1] as { edits: { newText: string }[] }).edits[0].newText).toBe('林舟站在码头。')
        return { id: 'r', status: 'applied', changes: [] } as never
      }
      return {} as never
    })
    const run = storyRewriteDraftTool.execute({ id: '1', version: 'v1', intent: '第三人称', summary: '保留事件', instruction: '改为跟随林舟的第三人称。' }, { modelId: 'model', signal: controller.signal })
    if (mode === 'complete') expect((await run).success).toBe(true)
    else await expect(run).rejects.toThrow(mode === 'cancelled' ? '取消' : '结束标记')
    expect(invoke.mock.calls.filter(([name]) => name === 'story:apply')).toHaveLength(mode === 'complete' ? 1 : 0)
  })
  it('aborts timed-out tools so a late result cannot submit a write', async () => {
    vi.useFakeTimers()
    try {
      const write = vi.fn()
      toolRegistry.register({ name: 'fixture', description: '', source: 'builtin', requiresConfirmation: false, isReadOnly: false, timeoutMs: 5, inputSchema: { type: 'object', properties: {} }, execute: async (_args, context) => {
        await new Promise(resolve => setTimeout(resolve, 20))
        if (!context?.signal?.aborted) write()
        return { success: false, content: '' }
      } })
      let step = 0
      const cb = callbacks()
      const run = runAgentLoop('', [], '修改', 'model', async () => ++step === 1 ? call : '任务已停止', cb)
      await vi.advanceTimersByTimeAsync(25)
      await run
      expect(write).not.toHaveBeenCalled()
      expect(cb.onToolCallComplete.mock.calls[0][0].status).toBe('failed')
    } finally { vi.useRealTimers() }
  })
  it('submits a complete chapter rewrite with the original version and rejects shortened placeholders', async () => {
    useProjectStore.setState({ currentProject: { path: 'D:/novel', novelConfig: {} } as never, loading: false })
    useCharacterStore.setState({ loaded: false }); useEditorStore.setState({ tabs: [] }); useWorkflowStore.setState({ activeRuns: [] })
    const original = '我'.repeat(3500) + '原稿末尾'
    const content = '林舟'.repeat(1800) + '原稿末尾'
    const invoke = vi.spyOn(ipc, 'invoke').mockImplementation(async (channel, ...args) => {
      if (channel === 'story:read') {
        const offset = (args[1] as { offset: number }).offset
        return { version: 'v1', content: original.slice(offset, offset + 3500), nextOffset: offset === 0 ? 3500 : null } as never
      }
      if (channel === 'story:apply') {
        const request = args[1] as { edits: { oldText: string; newText: string; version: string }[]; editWrittenText: boolean }
        expect(request.edits[0]).toMatchObject({ oldText: original, newText: content, version: 'v1' })
        expect(request.editWrittenText).toBe(true)
        return { id: 'r', status: 'applied', intent: '第三人称', changes: [] } as never
      }
      return {} as never
    })
    const args = { id: '1', version: 'v1', intent: '第三人称', summary: '保留事件', content }
    expect((await storyRewriteDraftTool.execute(args)).success).toBe(true)
    expect(invoke.mock.calls.filter(([name]) => name === 'story:apply')).toHaveLength(1)
    await expect(storyRewriteDraftTool.execute({ ...args, content: '后文省略' })).rejects.toThrow('不完整')
    await expect(storyRewriteDraftTool.execute({ ...args, version: 'old' })).rejects.toThrow('已有更新')
    expect(invoke.mock.calls.filter(([name]) => name === 'story:apply')).toHaveLength(1)
  })
  it('retries unstructured planning text in strict mode instead of ending before a tool executes', async () => {
    const execute = vi.fn(async () => ({ success: true, content: '已读到原文' }))
    toolRegistry.register({ name: 'fixture', description: '', source: 'builtin', requiresConfirmation: false, isReadOnly: true, inputSchema: { type: 'object', properties: {} }, execute })
    const replies = ['Reasoning...</think>我先读取章节。', JSON.stringify({ message: '读取章节', toolCall: { name: 'fixture', arguments: {} } }), JSON.stringify({ message: '已读到原文。', toolCall: null })]
    const cb = callbacks()
    const generate = vi.fn(async (messages: { content: string }[]) => {
      expect(messages.every(m => !m.content.includes('Reasoning...'))).toBe(true)
      return replies.shift()!
    })
    await runAgentLoop('', [], '请改写', 'test', generate, cb, undefined, undefined, true)
    expect(execute).toHaveBeenCalledOnce()
    expect(cb.onDone).toHaveBeenCalledOnce()
    expect(cb.onTextChunk.mock.calls.flat().join('')).not.toContain('Reasoning')
  })
  it('does not advertise or falsely report the legacy panel switch as an executed workflow', async () => {
    expect(builtinTools.some(tool => tool.name === 'start_workflow')).toBe(false)
    const result = await startWorkflowTool.execute({ workflow: 'refine', chapter_number: 1 })
    expect(result.success).toBe(false)
    expect(result.artifacts).toBeUndefined()
    expect(result.error).toContain('未启动任何工作流')
  })
  it('refreshes the open prose tab after an applied change and after undo', () => {
    useProjectStore.setState({ currentProject: { path: 'D:/novel', novelConfig: {} } as never })
    useEditorStore.setState({ tabs: [{ id: 'draft', filePath: 'vela://draft/1', type: 'chapter', name: '第1章', content: '我走进码头。', dirty: false }] })
    const revision = { id: 'r1', intent: '改成第三人称', summary: '保留情节', createdAt: '', status: 'applied' as const, changes: [{ kind: 'draft' as const, id: '1', title: '第1章', field: 'content', before: '我走进码头。', after: '林舟走进码头。' }] }
    refreshAfterStoryRevision('D:/novel', revision)
    expect(useEditorStore.getState().tabs[0]).toMatchObject({ content: '林舟走进码头。', dirty: false })
    expect(useEditorStore.getState().activeTabId).toBe('draft')
    refreshAfterStoryRevision('D:/novel', { ...revision, status: 'undone' })
    expect(useEditorStore.getState().tabs[0].content).toBe('我走进码头。')
  })
  it('does not write if cancelled during asynchronous preflight reads', async () => {
    useProjectStore.setState({ currentProject: { path: 'D:/novel', novelConfig: {} } as never, loading: false })
    useCharacterStore.setState({ loaded: false })
    useEditorStore.setState({ tabs: [] })
    useWorkflowStore.setState({ activeRuns: [] })
    const controller = new AbortController()
    const invoke = vi.spyOn(ipc, 'invoke').mockImplementation(async () => { controller.abort(); return {} as never })
    await expect(applyRevision('D:/novel', { intent: '修改', summary: '调整', edits: [] }, controller.signal)).rejects.toThrow('取消')
    expect(invoke.mock.calls.every(([name]) => name !== 'story:apply')).toBe(true)
  })
  it('extracts structured calls and questions without exposing gateway reasoning', () => {
    expect(parseToolCalls('Reasoning {example...}\n' + JSON.stringify({ message: '先读取', toolCall: { name: 'read_story', arguments: { kind: 'core', id: 'main' } } }))).toEqual({ textParts: ['先读取'], toolCalls: [{ name: 'read_story', arguments: { kind: 'core', id: 'main' } }] })
    expect(parseToolCalls(JSON.stringify({ message: '希望他死亡还是败走？', toolCall: null }))).toEqual({ textParts: ['希望他死亡还是败走？'], toolCalls: [] })
    const example = JSON.stringify({ message: 'example', toolCall: { name: 'revise_story', arguments: { edits_json: '[...]' } } })
    expect(parseToolCalls(`Reasoning example: ${example}\nActual response: {"message":"保存`, true)).toEqual({ textParts: [], toolCalls: [] })
  })
  it('stops to ask a creative question without executing a write', async () => {
    const cb = callbacks()
    await runAgentLoop('', [], '让反派下线', 'test', async () => '希望他死亡，还是败走？我建议败走，保留后续反转。', cb)
    expect(cb.onToolCallStart).not.toHaveBeenCalled()
    expect(cb.onDone.mock.calls[0][0]).toContain('我建议')
  })
  it('supports enough reading rounds and preserves paginated tool results', async () => {
    const execute = vi.fn(async () => ({ success: true, content: '字'.repeat(4000) + '末尾伏笔' }))
    toolRegistry.register({ name: 'fixture', description: '', source: 'builtin', requiresConfirmation: false, isReadOnly: true, maxResultChars: 12000, inputSchema: { type: 'object', properties: {} }, execute })
    let count = 0
    const cb = callbacks()
    await runAgentLoop('', [], '调整', 'test', async messages => {
      if (count) expect(messages.at(-1)?.content).toContain('末尾伏笔')
      return ++count <= 10 ? call : '检查完成'
    }, cb)
    expect(execute).toHaveBeenCalledTimes(10)
    expect(cb.onDone.mock.calls[0][0]).toContain('检查完成')
  })
  it('never executes late model results after the project changes', async () => {
    const execute = vi.fn(async () => ({ success: true, content: '' }))
    toolRegistry.register({ name: 'fixture', description: '', source: 'builtin', requiresConfirmation: false, isReadOnly: false, inputSchema: { type: 'object', properties: {} }, execute })
    let changed = false
    const cb = callbacks()
    await runAgentLoop('', [], '调整', 'test', async () => { changed = true; return call }, cb, undefined, () => { if (changed) throw new Error('PROJECT_CHANGED') })
    expect(execute).not.toHaveBeenCalled()
    expect(cb.onError).toHaveBeenCalled()
  })
  it('reports malformed operations as errors rather than pretending completion', async () => {
    const cb = callbacks()
    await runAgentLoop('', [], '调整', 'test', async () => '<tool_call>{broken', cb)
    expect(cb.onError).toHaveBeenCalledOnce()
    expect(cb.onDone).not.toHaveBeenCalled()
  })
})
