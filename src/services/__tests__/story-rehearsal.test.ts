import { describe, expect, it, vi } from 'vitest'
import {
  appendRehearsalGuidance, buildRehearsalMessages, buildRehearsalSceneMessages,
  parseRehearsalDirections, generateRehearsalDirections, type RehearsalInput,
} from '../story-rehearsal'

const direction = (number: number) => ({
  title: `方向${number}`, premise: `不同因果${number}`, motive: '保住人证', opposition: '对手扣下副本',
  cost: '主角失去自由', aftermath: '关系断裂', setup: '待补：人证受困的依据', risk: '避免廉价洗白', events: '交出行踪',
})
const input: RehearsalInput = {
  intent: '让师父真正背叛主角', constraints: '不能轻易原谅', language: 'zh-CN',
  blueprint: {
    chapterNumber: 5, title: '来信', role: '转折', purpose: '关系断裂', keyEvents: '交出行踪',
    characters: ['师父', '主角'], suspenseHook: '', userGuidance: '保留作者原话\n',
    notes: '本章定稿后的信息不该进入试演', notesUpdatedAt: '',
  },
  context: {
    projectPath: 'D:/test', targetChapter: 5, authorPlan: { synopsis: '未来主角会原谅' }, planTruncated: false,
    previousExcerpts: [{ chapterNumber: 4, draftId: 9, version: 2, text: '他把信藏在袖里。', truncated: false }],
  },
}

describe('story rehearsal contract', () => {
  it('accepts only a complete final JSON after an introduction, never an earlier example', () => {
    const result = JSON.stringify({ directions: [1, 2, 3].map(direction) })
    expect(parseRehearsalDirections(`三个方向如下：\n\`\`\`json\n${result}\n\`\`\``)).toEqual([1, 2, 3].map(direction))
    expect(parseRehearsalDirections(`unfinished reasoning</think>\n${result}`)).toEqual([1, 2, 3].map(direction))
    expect(() => parseRehearsalDirections(`Example: ${result}\nFinal answer: {"directions":[`)).toThrow('INVALID_RESPONSE')
  })

  it('retries malformed output once, then still performs the constraint review', async () => {
    const valid = JSON.stringify({ directions: [1, 2, 3].map(direction) })
    const generate = vi.fn().mockResolvedValueOnce('Let me plan this...').mockResolvedValueOnce(valid).mockResolvedValueOnce(valid)
    const retry = vi.fn(), review = vi.fn()
    expect(await generateRehearsalDirections(input, generate, review, retry)).toEqual([1, 2, 3].map(direction))
    expect(generate).toHaveBeenCalledTimes(3)
    expect(retry).toHaveBeenCalledTimes(1)
    expect(review).toHaveBeenCalledTimes(1)
    expect(generate.mock.calls[1][0][0].content).toContain('Return the final JSON object now')
    expect(JSON.stringify(generate.mock.calls[1][0])).not.toContain('Let me plan this')
  })

  it('bounds format retries and never returns the unreviewed first result on repeated review failure', async () => {
    const valid = JSON.stringify({ directions: [1, 2, 3].map(direction) })
    const generate = vi.fn().mockResolvedValueOnce(valid).mockResolvedValue('incomplete')
    const retry = vi.fn()
    await expect(generateRehearsalDirections(input, generate, vi.fn(), retry)).rejects.toThrow('INVALID_RESPONSE')
    expect(generate).toHaveBeenCalledTimes(3)
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it('runs exactly one review and only returns the validated reviewed proposals', async () => {
    const generate = vi.fn().mockResolvedValueOnce(JSON.stringify({ directions: [1, 2, 3].map(direction) }))
      .mockResolvedValueOnce(JSON.stringify({ directions: [4, 5, 6].map(direction) }))
    const onReview = vi.fn()
    expect(await generateRehearsalDirections(input, generate, onReview)).toEqual([4, 5, 6].map(direction))
    expect(generate).toHaveBeenCalledTimes(2)
    expect(onReview).toHaveBeenCalledTimes(1)
    expect(generate.mock.calls[1][0][1].content).toContain('proposedDirections')
  })

  it('does not return unreviewed candidates when the review fails', async () => {
    const generate = vi.fn().mockResolvedValueOnce(JSON.stringify({ directions: [1, 2, 3].map(direction) }))
      .mockRejectedValueOnce(new Error('review offline'))
    await expect(generateRehearsalDirections(input, generate, vi.fn())).rejects.toThrow('review offline')
    expect(generate).toHaveBeenCalledTimes(2)
  })
  it('accepts fenced JSON and strips thinking without leaking it into directions', () => {
    const values = [1, 2, 3].map(direction)
    expect(parseRehearsalDirections(`<think>private</think>\n\`\`\`json\n${JSON.stringify({ directions: values })}\n\`\`\``)).toEqual(values)
  })

  it.each([
    '{}', '{"directions":[]}', JSON.stringify({ directions: [direction(1), direction(2)] }),
    JSON.stringify({ directions: [direction(1), direction(2), { ...direction(3), cost: '' }] }),
    JSON.stringify({ directions: [direction(1), direction(2), { ...direction(3), motive: { nested: true } }] }),
    'model refused', 'x'.repeat(60001),
  ])('rejects malformed or incomplete responses', text => {
    expect(() => parseRehearsalDirections(text)).toThrow('INVALID_RESPONSE')
  })

  it('rejects duplicate causal approaches even if titles differ', () => {
    expect(() => parseRehearsalDirections(JSON.stringify({ directions: [direction(1), direction(2), { ...direction(3), premise: '不同 因果1' }] })))
      .toThrow('DUPLICATE_DIRECTIONS')
  })

  it('keeps author plans separate from manuscript evidence and excludes target notes', () => {
    const messages = buildRehearsalMessages(input)
    const data = JSON.parse(messages[1].content)
    expect(data.authorPlan.synopsis).toBe('未来主角会原谅')
    expect(data.previousFinalizedExcerpts[0].draftId).toBe(9)
    expect(messages[1].content).not.toContain(input.blueprint.notes)
    expect(messages[0].content).toContain('NOT evidence')
    expect(data.constraints).toBe(input.constraints)
  })

  it('refuses mismatched chapter contexts and empty intentions', () => {
    expect(() => buildRehearsalMessages({ ...input, context: { ...input.context, targetChapter: 6 } })).toThrow('INVALID_CHAPTER')
    expect(() => buildRehearsalMessages({ ...input, intent: ' ' })).toThrow('INVALID_INPUT')
  })

  it('scene uses the selected proposal and the explicit information-reveal direction', () => {
    const messages = buildRehearsalSceneMessages(input, direction(2), '不揭晓幕后人')
    expect(messages[1].content).toContain('不同因果2')
    expect(messages[1].content).not.toContain('不同因果1')
    expect(messages[1].content).toContain('不揭晓幕后人')
  })

  it('adoption appends to guidance without mutating prose, notes or any blueprint field', () => {
    const before = structuredClone(input.blueprint)
    const after = appendRehearsalGuidance(input.blueprint, '选定计划')
    expect(input.blueprint).toEqual(before)
    expect(after.userGuidance).toBe('保留作者原话\n\n\n选定计划')
    expect({ ...after, userGuidance: before.userGuidance }).toEqual(before)
  })
})
