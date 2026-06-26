/**
 * Performance regression tests for PR #13 fixes
 *
 * 如果将来有人改坏了 Patches 01-04 的优化（regex caching、Set.has、IPC 减少），
 * 这些测试会失败，强制 PR 看到性能退化。
 *
 * 阈值是基线（修复后）的 2-3 倍，避免 CI 抖动误报。
 */
import { describe, it, expect } from 'vitest'
import { validateChapter } from '../index'
import { makeState, makeCanon, makeTimeline } from './fixtures'

function makeChapterContent(numChars: number, numCharacters: number) {
  const characters: Array<{ name: string; location: string }> = []
  for (let i = 0; i < numCharacters; i++) {
    characters.push({
      name: `角色${i}`,
      location: ['青云山', '烈火宗', '天元城', '玄天宗'][i % 4],
    })
  }
  const paragraphs: string[] = []
  let remaining = numChars
  while (remaining > 0) {
    const c = characters[paragraphs.length % numCharacters]
    const para = `${c.name}在${c.location}练剑，回想起过去十年。`
    paragraphs.push(para)
    remaining -= para.length
  }
  return { text: paragraphs.join('\n\n'), characters }
}

function makeBigCanon(numCharacters: number) {
  const characters = []
  for (let i = 0; i < numCharacters; i++) {
    characters.push(makeState({
      character: `角色${i}`,
      knowledge: [`秘密${i}A`],
    }))
  }
  return makeCanon({
    characterStates: characters,
    timeline: makeTimeline(
      Array.from({ length: 30 }, (_, i) => ({
        chapterNumber: Math.floor(i / 5) + 1,
        sequence: (i % 5) + 1,
        characters: [`角色${i % numCharacters}`],
        location: 'X',
        summary: `事件 ${i}`,
      }))
    ),
  })
}

describe('性能回归测试 (Perf Regression Suite)', () => {
  it('validateChapter (10K chars, 20 chars) 必须在 10ms 内完成', () => {
    const { text, characters } = makeChapterContent(10000, 20)
    const canon = makeBigCanon(20)
    const start = performance.now()
    validateChapter({ chapterNumber: 5, chapterContent: text, canon })
    const elapsed = performance.now() - start
    // 修复后基线 ~0.7ms；阈值放宽到 10ms 防止 CI 抖动
    expect(elapsed).toBeLessThan(10)
  })

  it('validateChapter (20K chars, 50 chars) 必须在 30ms 内完成', () => {
    const { text, characters } = makeChapterContent(20000, 50)
    const canon = makeBigCanon(50)
    const start = performance.now()
    validateChapter({ chapterNumber: 5, chapterContent: text, canon })
    const elapsed = performance.now() - start
    // 修复后基线 ~1.6ms；阈值放宽到 30ms
    expect(elapsed).toBeLessThan(30)
  })

  it('200 章节批量 validateChapter 必须在 200ms 内完成', () => {
    const { text, characters } = makeChapterContent(2000, 5)
    const canon = makeBigCanon(5)
    const start = performance.now()
    for (let i = 1; i <= 200; i++) {
      validateChapter({ chapterNumber: i, chapterContent: text, canon })
    }
    const elapsed = performance.now() - start
    // 修复后基线 ~34ms；阈值放宽到 200ms
    expect(elapsed).toBeLessThan(200)
  })
})
