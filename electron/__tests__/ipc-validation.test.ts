/**
 * Tests for electron/ipc-validation.ts
 * 防止 IPC 入口接受畸形/超大数据导致 DoS 或 data corruption
 */
import { describe, it, expect } from 'vitest'
import {
  ValidationError,
  checkStringLength,
  checkNumberRange,
  checkEnum,
  checkArray,
  safeValidate,
  validateCanonTimelineEventInput,
  validateCanonFactInput,
  validateCanonPlotLineInput,
  validateCanonCharacterStateSnapshot,
  validateCanonChapterSummary,
  validateCanonWritebackPayload,
  VALID_PLOT_STATUS,
} from '../ipc-validation'

describe('基本校验工具', () => {
  it('checkStringLength 接受合法字符串', () => {
    expect(checkStringLength('hello', 'p', { max: 10 })).toBe('hello')
  })

  it('checkStringLength 拒绝过长字符串', () => {
    expect(() => checkStringLength('a'.repeat(11), 'p', { max: 10 })).toThrow(ValidationError)
  })

  it('checkStringLength 拒绝过短字符串', () => {
    expect(() => checkStringLength('', 'p', { min: 1, max: 10 })).toThrow(/too short/)
  })

  it('checkStringLength 拒绝非字符串', () => {
    expect(() => checkStringLength(123, 'p', { max: 10 })).toThrow(/expected string/)
  })

  it('checkNumberRange 接受范围内整数', () => {
    expect(checkNumberRange(5, 'p', { min: 0, max: 10, integer: true })).toBe(5)
  })

  it('checkNumberRange 拒绝越界值', () => {
    expect(() => checkNumberRange(11, 'p', { min: 0, max: 10 })).toThrow(/above max/)
    expect(() => checkNumberRange(-1, 'p', { min: 0, max: 10 })).toThrow(/below min/)
  })

  it('checkNumberRange 拒绝非数字', () => {
    expect(() => checkNumberRange('abc', 'p', { min: 0, max: 10 })).toThrow(/expected number/)
  })

  it('checkEnum 接受合法值', () => {
    expect(checkEnum('active', 'p', VALID_PLOT_STATUS)).toBe('active')
  })

  it('checkEnum 拒绝非法值', () => {
    expect(() => checkEnum('unknown', 'p', VALID_PLOT_STATUS)).toThrow(/expected one of/)
  })

  it('checkArray 接受合法数组', () => {
    expect(checkArray([1, 2, 3], 'p', (x) => x as number, { maxLength: 5 })).toEqual([1, 2, 3])
  })

  it('checkArray 拒绝超长数组（DoS 防护）', () => {
    const huge = Array.from({ length: 1001 }, (_, i) => i)
    expect(() => checkArray(huge, 'p', (x) => x, { maxLength: 1000 })).toThrow(/too long/)
  })

  it('safeValidate 包装成功和失败', () => {
    const ok = safeValidate((v: unknown) => checkStringLength(v, 'p', { max: 5 }), 'abc')
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.data).toBe('abc')

    const fail = safeValidate((v: unknown) => checkStringLength(v, 'p', { max: 5 }), 'too long string')
    expect(fail.ok).toBe(false)
    if (!fail.ok) expect(fail.error).toContain('too long')
  })
})

describe('Canon 输入校验 — DoS / 数据污染防护', () => {
  it('validateCanonFactInput 接受合法 fact', () => {
    const ok = validateCanonFactInput({
      category: 'identity', statement: 'X 是 Y', introducedAt: 1, characters: ['X'], evidence: '',
    })
    expect(ok.statement).toBe('X 是 Y')
  })

  it('validateCanonFactInput 拒绝非法 category（避免垃圾枚举）', () => {
    expect(() => validateCanonFactInput({
      category: 'FAKE_CATEGORY', statement: 'X', introducedAt: 1, characters: [],
    })).toThrow(/expected one of/)
  })

  it('validateCanonFactInput 拒绝 1GB statement（DoS 防护）', () => {
    const huge = 'x'.repeat(1_000_000)  // 1MB — 仍能 catch
    expect(() => validateCanonFactInput({
      category: 'identity', statement: huge, introducedAt: 1, characters: [],
    })).toThrow(/too long/)
  })

  it('validateCanonTimelineEventInput 拒绝非法 timeFlow', () => {
    expect(() => validateCanonTimelineEventInput({
      chapterNumber: 1, sequence: 1, characters: ['X'], location: 'A',
      timeFlow: 'NEGATIVE_FUTURE', summary: 'e', impact: '',
    })).toThrow(/expected one of/)
  })

  it('validateCanonCharacterStateSnapshot 拒绝过长 knowledge 列表', () => {
    expect(() => validateCanonCharacterStateSnapshot({
      character: 'X', knowledge: Array.from({ length: 1001 }, (_, i) => `k${i}`),
    })).toThrow(/too long/)
  })

  it('validateCanonPlotLineInput 拒绝非法 status', () => {
    expect(() => validateCanonPlotLineInput({
      name: 'plot', status: 'WRONG_STATUS', startedAt: 1, lastAdvancedAt: 1,
      characters: [], currentState: '', description: '',
    })).toThrow(/expected one of/)
  })

  it('validateCanonChapterSummary 拒绝超长 summary', () => {
    expect(() => validateCanonChapterSummary({
      chapterNumber: 1, title: 't', summary: 'x'.repeat(10000), createdAt: '',
    })).toThrow(/too long/)
  })
})

describe('validateCanonWritebackPayload 集成校验', () => {
  it('接受合法 writeback payload', () => {
    const payload = {
      chapterNumber: 5,
      newEvents: [{ chapterNumber: 5, sequence: 1, characters: ['X'], location: 'A', timeFlow: 'sequential' as const, summary: 'e', impact: '' }],
      characterDeltas: [],
      newFacts: [],
    }
    const v = validateCanonWritebackPayload(payload)
    expect(v.chapterNumber).toBe(5)
    expect(v.newEvents).toHaveLength(1)
  })

  it('拒绝超长 newEvents 列表（DoS 防护）', () => {
    const events = Array.from({ length: 1001 }, (_, i) => ({
      chapterNumber: 1, sequence: i + 1, characters: ['X'], location: 'A',
      timeFlow: 'sequential' as const, summary: 'e', impact: '',
    }))
    expect(() => validateCanonWritebackPayload({
      chapterNumber: 1, newEvents: events, characterDeltas: [], newFacts: [],
    })).toThrow(/too long/)
  })

  it('拒绝嵌套字段的错误枚举', () => {
    expect(() => validateCanonWritebackPayload({
      chapterNumber: 1,
      newEvents: [{ chapterNumber: 1, sequence: 1, characters: ['X'], location: 'A', timeFlow: 'FUTURE' as any, summary: 'e', impact: '' }],
      characterDeltas: [],
      newFacts: [],
    })).toThrow(/expected one of/)
  })
})

describe('safeValidate 包装：实际 IPC 场景', () => {
  it('1GB statement 不会到达 DB 层', () => {
    const result = safeValidate(validateCanonFactInput, {
      category: 'identity', statement: 'x'.repeat(1_000_000), introducedAt: 1, characters: [],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('too long')
    }
  })

  it('malicious category 不会到达 DB 层', () => {
    const result = safeValidate(validateCanonFactInput, {
      category: '<script>alert(1)</script>', statement: 'X', introducedAt: 1, characters: [],
    })
    expect(result.ok).toBe(false)
  })
})
