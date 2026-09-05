import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseTextBlueprints, createDirectoryWorkflow } from '../workflows/directory-workflow'
import { GenerateDirectoryCommand } from '../workflows/commands/directory.command'
import { BaseWorkflowCommand } from '../workflows/commands/base-command'
import { useProjectStore } from '../../stores/project-store'
import { useLLMStore } from '../../stores/llm-store'
import { ipc } from '../ipc-client'

const item = (chapterNumber: number) => ({ chapterNumber, title: `第${chapterNumber}章`, keyEvents: '主角发现证据并付出代价。', characters: ['主角'] })
const callbacks = { log: vi.fn(), setProgress: vi.fn(), appendText: vi.fn() }
const context = () => ({ data: { architecture: '已经完成的全书架构' } as Record<string, unknown>, cancelled: false })
beforeEach(() => {
  vi.restoreAllMocks()
  useProjectStore.setState({ currentProject: { id: 'A', path: 'D:/test/A', novelConfig: { totalChapters: 100, genre: '悬疑' } } as never })
  useLLMStore.setState({ defaultModelId: 'model', models: [{ id: 'model', maxTokens: 4096 }] as never })
  vi.spyOn(useProjectStore.getState(), 'refreshFileTree').mockResolvedValue(undefined)
})
describe('directory generation never reports empty output as success', () => {
  it('accepts complete raw arrays and fenced object envelopes', () => {
    expect(parseTextBlueprints(JSON.stringify([item(1), item(2)]), 1, 2)).toHaveLength(2)
    expect(parseTextBlueprints('```json\r\n' + JSON.stringify({ blueprints: [item(1)] }) + '\r\n```', 1, 2)).toHaveLength(1)
  })
  it('extracts the final answer after untagged reasoning containing JSON examples', () => {
    const final = { ...item(1), keyEvents: '线索包含括号 } 和转义引号 "，仍然是完整事件。' }
    const raw = 'Plan: { "blueprints": [ { "chapterNumber": 1, ... } ] }\nFinal JSON: ' + JSON.stringify({ blueprints: [final] })
    expect(parseTextBlueprints(raw, 1, 3)).toEqual([expect.objectContaining(final)])
    expect(parseTextBlueprints(JSON.stringify({ blueprints: [final] }).slice(0, -3), 1, 3)).toEqual([])
    expect(parseTextBlueprints(JSON.stringify([{ ...final, characters: [] }]), 1, 3)).toHaveLength(1)
    expect(parseTextBlueprints(JSON.stringify([item(1)]) + '\nFinal: []', 1, 3)).toEqual([])
  })
  it('rejects empty output before saving or skipping ahead', async () => {
    vi.spyOn(BaseWorkflowCommand.prototype as unknown as { callLLM: (...args: unknown[]) => Promise<string> }, 'callLLM').mockResolvedValue('{"blueprints":[]}')
    const invoke = vi.spyOn(ipc, 'invoke').mockResolvedValue({ success: true } as never)
    await expect(new GenerateDirectoryCommand({ mode: 'full', count: 3 }).execute({ step: {}, context: context(), callbacks })).rejects.toThrow()
    expect(invoke.mock.calls.filter(([channel]) => channel === 'db:blueprint-upsert-many')).toHaveLength(0)
  })
  it('limits the first prompt to its batch and saves with project ownership', async () => {
    const llm = vi.spyOn(BaseWorkflowCommand.prototype as unknown as { callLLM: (...args: unknown[]) => Promise<string> }, 'callLLM')
    llm.mockResolvedValueOnce(JSON.stringify({ blueprints: [1, 2, 3, 4].map(item) })).mockResolvedValueOnce(JSON.stringify({ blueprints: [item(5)] }))
    const invoke = vi.spyOn(ipc, 'invoke').mockResolvedValue({ success: true } as never)
    const result = await new GenerateDirectoryCommand({ mode: 'full', count: 5 }).execute({ step: {}, context: context(), callbacks })
    expect(result).toHaveLength(5)
    expect(llm.mock.calls[0]?.[0]).toContain('第4章')
    expect(invoke.mock.calls.filter(([channel]) => channel === 'db:blueprint-upsert-many').every(call => call[2] === 'D:/test/A')).toBe(true)
  })
  it('does not skip a missing chapter and call a partial batch complete', async () => {
    vi.spyOn(BaseWorkflowCommand.prototype as unknown as { callLLM: (...args: unknown[]) => Promise<string> }, 'callLLM').mockResolvedValue(JSON.stringify([item(1), item(3)]))
    vi.spyOn(ipc, 'invoke').mockResolvedValue({ success: true } as never)
    await expect(new GenerateDirectoryCommand({ mode: 'full', count: 3 }).execute({ step: {}, context: context(), callbacks })).rejects.toThrow()
  })
  it('does not save late model results into another project', async () => {
    vi.spyOn(BaseWorkflowCommand.prototype as unknown as { callLLM: (...args: unknown[]) => Promise<string> }, 'callLLM').mockImplementation(async () => {
      useProjectStore.setState({ currentProject: { id: 'B', path: 'D:/test/B' } as never })
      return JSON.stringify({ blueprints: [item(1)] })
    })
    const invoke = vi.spyOn(ipc, 'invoke').mockResolvedValue({ success: true } as never)
    await expect(new GenerateDirectoryCommand({ mode: 'full', count: 1 }).execute({ step: {}, context: context(), callbacks })).rejects.toThrow()
    expect(invoke.mock.calls.filter(([channel]) => channel === 'db:blueprint-upsert-many')).toHaveLength(0)
  })
  it('refuses the final success/save step with zero chapters', async () => {
    vi.spyOn(ipc, 'invoke').mockResolvedValue({ success: true } as never)
    const workflow = createDirectoryWorkflow({ mode: 'full' })
    await expect(workflow.steps[2].executor({} as never, { data: { newBlueprints: [], existingBlueprints: [] }, cancelled: false }, callbacks)).rejects.toThrow()
  })
})
