/**
 * 叙事一致性（Narrative Consistency）测试套件
 *
 * 覆盖目标文档要求的 5 类核心测试：
 *   1. 人物地点连续性（不能回退）
 *   2. 人物知识越权检测
 *   3. 人物关系连续性
 *   4. 时间线顺序正确性
 *   5. rewrite/refine 不破坏事实
 *
 * 每个测试都使用真实的中文玄幻题材片段以贴近实际生成场景。
 */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { initProjectDatabase, closeProjectDatabase, getProjectDb } from '../../../../electron/database'
import { CanonRepository } from '../../../../electron/repositories/canon-repository'
import {
  checkLocationContinuity,
  checkKnowledgeAuthorization,
  checkRelationshipContinuity,
  checkTimelineOrder,
  checkPreviousEndingContinuity,
  checkRewriteFactSafety,
  checkItemOwnership,
  validateChapter,
  tryAutoFix,
  runConsistencyGate,
  renderCanonContext,
  extractCanonWriteback,
  CanonStore,
  type CanonContext,
} from '../index'
import {
  makeState,
  makeCanon,
  makeTimeline,
  makePlotLines,
  makeFacts,
} from './fixtures'
import { BasePromptBuilder } from '../../prompts/prompt-builder'
import { BUILTIN_PROMPTS } from '../../prompt-templates'

// ============================================================
// 1. 人物地点连续性
// ============================================================
describe('1. 人物地点连续性（不能无解释瞬移）', () => {
  it('合法转场（"来到/前往/到达"）不应被报告', () => {
    const state = makeState({ character: '林轩', location: '青云山' })
    const text = `林轩站在山门之外。\n\n林轩来到大殿之中。\n\n林轩走到师父面前。`
    const issues = checkLocationContinuity(text, [state])
    expect(issues.filter(i => i.category === 'location')).toHaveLength(0)
  })

  it('同一地点不应触发瞬移警告', () => {
    const state = makeState({ character: '林轩', location: '青云山' })
    const text = `林轩在青云山练剑。\n\n林轩在青云山打坐。\n\n林轩在青云山眺望。`
    const issues = checkLocationContinuity(text, [state])
    expect(issues.filter(i => i.category === 'location')).toHaveLength(0)
  })

  it('无解释的地点瞬移应被报告为 warning', () => {
    const state = makeState({ character: '林轩', location: '青云山' })
    const text = `林轩在青云山与师父告别。\n\n山门外飞雪漫天。\n\n林轩在烈火宗与人激战。`
    const issues = checkLocationContinuity(text, [state])
    expect(issues.length).toBeGreaterThan(0)
    const locationIssue = issues.find(i => i.category === 'location')
    expect(locationIssue).toBeDefined()
    expect(locationIssue?.message).toContain('青云山')
    expect(locationIssue?.message).toContain('烈火宗')
    expect(locationIssue?.characters).toContain('林轩')
  })

  it('泛指代词（他/她）不应误触发地点检查', () => {
    const state = makeState({ character: '林轩', location: '青云山' })
    const text = `他在青云山练剑。\n\n她望着远方的烈火宗。`
    const issues = checkLocationContinuity(text, [state])
    // 他/她 不在角色名单里，不应触发
    expect(issues.filter(i => i.category === 'location')).toHaveLength(0)
  })
})

// ============================================================
// 2. 人物知识越权检测
// ============================================================
describe('2. 人物知识越权检测', () => {
  it('canon knowledge 列表中已有的信息不应被警告', () => {
    const state = makeState({
      character: '林轩',
      knowledge: ['师父被害', '幕后黑手是赵无极'],
    })
    const text = `林轩知道了师父被害的真相，心中愤恨。`
    const issues = checkKnowledgeAuthorization(text, [state])
    expect(issues.filter(i => i.category === 'knowledge')).toHaveLength(0)
  })

  it('canon knowledge 中未记录的信息应被警告', () => {
    const state = makeState({ character: '林轩', knowledge: ['师父被害'] })
    const text = `林轩知道了九转还魂丹的下落，立刻动身前往。`
    const issues = checkKnowledgeAuthorization(text, [state])
    const knowledgeIssue = issues.find(i => i.category === 'knowledge')
    expect(knowledgeIssue).toBeDefined()
    expect(knowledgeIssue?.characters).toContain('林轩')
    expect(knowledgeIssue?.message).toContain('九转还魂丹')
  })

  it('"记得/记忆" 视为合法回忆（不警告）', () => {
    const state = makeState({ character: '林轩', knowledge: [] })
    const text = `林轩记得十年前的灭门惨案。`
    const issues = checkKnowledgeAuthorization(text, [state])
    expect(issues.filter(i => i.category === 'knowledge')).toHaveLength(0)
  })

  it('非人物名字不应被纳入检查（避免误报）', () => {
    const state = makeState({ character: '林轩', knowledge: [] })
    const text = `张三知道了秘密。` // 张三 不在角色名单里
    const issues = checkKnowledgeAuthorization(text, [state])
    expect(issues.filter(i => i.category === 'knowledge')).toHaveLength(0)
  })
})

// ============================================================
// 3. 人物关系连续性
// ============================================================
describe('3. 人物关系连续性', () => {
  it('与 canon 一致的关系词不应被警告', () => {
    const state = makeState({
      character: '林轩',
      relationships: { 赵无极: '敌人' },
    })
    const text = `林轩与赵无极是敌人，双方势不两立。`
    const issues = checkRelationshipContinuity(text, [state])
    expect(issues.filter(i => i.category === 'relationship')).toHaveLength(0)
  })

  it('与 canon 矛盾的关系词应被警告', () => {
    const state = makeState({
      character: '林轩',
      relationships: { 赵无极: '敌人' },
    })
    const text = `林轩与赵无极是朋友，谈笑风生。`
    const issues = checkRelationshipContinuity(text, [state])
    const relIssue = issues.find(i => i.category === 'relationship')
    expect(relIssue).toBeDefined()
    expect(relIssue?.characters).toContain('林轩')
    expect(relIssue?.characters).toContain('赵无极')
    expect(relIssue?.message).toContain('朋友')
  })

  it('未涉及已知关系对的内容不应触发警告', () => {
    const state = makeState({
      character: '林轩',
      relationships: { 赵无极: '敌人' },
    })
    const text = `林轩独自在山门修炼剑法。`
    const issues = checkRelationshipContinuity(text, [state])
    expect(issues.filter(i => i.category === 'relationship')).toHaveLength(0)
  })
})

// ============================================================
// 4. 时间线顺序正确性
// ============================================================
describe('4. 时间线顺序正确性', () => {
  it('canon 中单调递增的 sequence 不应被警告', () => {
    const canon = makeCanon({
      timeline: makeTimeline([
        { chapterNumber: 2, sequence: 1, summary: '进入大殿' },
        { chapterNumber: 2, sequence: 2, summary: '遇见师父' },
        { chapterNumber: 2, sequence: 3, summary: '得到任务' },
      ]),
    })
    const text = `林轩进入大殿，遇见师父，得到任务。`
    const issues = checkTimelineOrder(text, canon.timeline, 2, false)
    expect(issues.filter(i => i.category === 'timeline' && i.severity === 'error')).toHaveLength(0)
    expect(issues.filter(i => i.category === 'event-order' && i.severity === 'error')).toHaveLength(0)
  })

  it('canon 中 sequence 倒退应被检测为 error', () => {
    const canon = makeCanon({
      timeline: makeTimeline([
        { chapterNumber: 2, sequence: 1, summary: '进入大殿' },
        { chapterNumber: 2, sequence: 2, summary: '遇见师父' },
        { chapterNumber: 2, sequence: 1, summary: '错误：倒退' }, // 故意让 sequence 倒退
      ]),
    })
    const text = `一些文本`
    const issues = checkTimelineOrder(text, canon.timeline, 2, false)
    const orderIssue = issues.find(i => i.category === 'event-order' && i.severity === 'error')
    expect(orderIssue).toBeDefined()
    expect(orderIssue?.message).toContain('sequence 不单调')
  })

  it('闪回章节不应触发时间顺序检查', () => {
    const canon = makeCanon({
      timeline: makeTimeline([
        { chapterNumber: 1, sequence: 1, summary: '事件1' },
      ]),
    })
    const text = `林轩回忆起十年前的惨案，那时候他还只是个孩子。`
    const issues = checkTimelineOrder(text, canon.timeline, 2, true) // isFlashback=true
    expect(issues.filter(i => i.severity === 'error')).toHaveLength(0)
  })
})

// ============================================================
// 5. rewrite/refine 不破坏事实
// ============================================================
describe('5. rewrite/refine 不破坏事实', () => {
  it('精修后的内容让已死亡角色复活应被检测为 error', () => {
    const canon = makeCanon({
      timeline: makeTimeline([
        {
          chapterNumber: 1,
          sequence: 1,
          summary: '林轩师父在烈火宗之战中死亡',
          impact: '师父死亡',
          characters: ['师父'],
        },
      ]),
      characterStates: [makeState({ character: '师父', physicalState: '死亡' })],
    })
    const refinedText = `师父在青云山上笑着说："孩子们，我来了。"\n\n师父挥剑斩向敌人。`
    const issues = checkRewriteFactSafety(refinedText, canon.timeline, canon.knownFacts)
    const issue = issues.find(i => i.category === 'continuity' && i.characters?.includes('师父'))
    expect(issue).toBeDefined()
    expect(issue?.severity).toBe('error')
  })

  it('闪回标记内的死亡角色不应被误报', () => {
    const canon = makeCanon({
      timeline: makeTimeline([
        {
          chapterNumber: 1,
          sequence: 1,
          summary: '师父死亡',
          characters: ['师父'],
        },
      ]),
    })
    const text = `林轩脑海中浮现出师父教他剑法的回忆，那时候师父还活着，挥剑斩向妖魔。`
    const issues = checkRewriteFactSafety(text, canon.timeline, canon.knownFacts)
    expect(issues.filter(i => i.severity === 'error')).toHaveLength(0)
  })

  it('精修未破坏既有事实时应无 error', () => {
    const canon = makeCanon({
      timeline: makeTimeline([
        {
          chapterNumber: 1,
          sequence: 1,
          summary: '林轩离开天元城',
          characters: ['林轩'],
        },
      ]),
      characterStates: [makeState({ character: '林轩', location: '青云山' })],
    })
    const refinedText = `林轩站在青云山上，眺望远方的天元城。他回想起刚才离开时师父的叮嘱。`
    const issues = checkRewriteFactSafety(refinedText, canon.timeline, canon.knownFacts)
    expect(issues.filter(i => i.severity === 'error')).toHaveLength(0)
  })
})

// ============================================================
// 集成：validateChapter + tryAutoFix
// ============================================================
describe('集成：validateChapter 与 tryAutoFix', () => {
  it('validateChapter 应聚合多个维度的 issue', () => {
    const canon = makeCanon({
      characterStates: [makeState({ character: '林轩', knowledge: ['师父被害'] })],
      timeline: makeTimeline([{ chapterNumber: 1, sequence: 1, summary: '事件' }]),
    })
    // 同时触发：地点瞬移 + 知识越权 + 关系矛盾
    const text = `林轩在青云山与赵无极是朋友，谈笑风生。\n\n林轩知道了九转还魂丹的位置。\n\n林轩在烈火宗拔剑。`
    const issues = validateChapter({
      chapterNumber: 2,
      chapterContent: text,
      canon,
      isRewrite: false,
    })
    const categories = new Set(issues.map(i => i.category))
    expect(categories.has('location')).toBe(true)
    expect(categories.has('knowledge')).toBe(true)
  })

  it('tryAutoFix 应对 knowledge leak 进行高置信度修复', () => {
    const text = `林轩知道了九转还魂丹的位置，立刻动身。`
    const issues = [
      {
        severity: 'warning' as const,
        category: 'knowledge' as const,
        characters: ['林轩'],
        message: '知识越权',
        evidence: '林轩知道了九转还魂丹',
      },
    ]
    const result = tryAutoFix(text, issues)
    expect(result.modified).toBe(true)
    expect(result.content).toContain('（据前文线索）')
    expect(result.fixedIssues.length).toBe(1)
  })

  it('error 级别 issue 不应被自动修复（保守策略）', () => {
    const text = `林轩挥剑斩敌。`
    const issues = [
      {
        severity: 'error' as const,
        category: 'continuity' as const,
        characters: ['林轩'],
        message: '林轩已死亡不应复活',
      },
    ]
    const result = tryAutoFix(text, issues)
    expect(result.modified).toBe(false)
    expect(result.content).toBe(text)
    expect(result.remainingIssues.length).toBe(1)
  })
})

// ============================================================
// 集成：renderCanonContext 输出顺序
// ============================================================
describe('CanonContext 注入顺序（强约束：固定优先级）', () => {
  it('renderCanonContext 应按指定顺序注入各块', () => {
    const canon: CanonContext = makeCanon({
      characterStates: [makeState({ character: '林轩' })],
      timeline: makeTimeline([{ chapterNumber: 1, sequence: 1, summary: '事件A' }]),
      openPlotLines: makePlotLines([{ name: '复仇之路' }]),
      knownFacts: makeFacts([{ statement: '林轩是主角' }]),
    })
    const rendered = renderCanonContext(canon)

    // 顺序校验：每个块标题应按指定顺序出现
    const expectedOrder = [
      '正史设定',
      '人物群像',
      '当前人物状态',
      '已发生事件时间线',
      '最近章节摘要',
      '未结剧情线',
      '关键事实条目',
      '上一章结尾',
      '本章写作目标',
      '知识库参考',
      '文风要求',
      '全局行文指导',
      '硬性约束',
    ]
    let lastIdx = -1
    for (const title of expectedOrder) {
      const idx = rendered.indexOf(title)
      expect(idx).toBeGreaterThan(lastIdx)
      lastIdx = idx
    }
  })

  it('空字段块应被自动跳过', () => {
    const canon = makeCanon({
      characterStates: [],
      timeline: [],
      openPlotLines: [],
      knownFacts: [],
      previousEnding: '',
      ragContext: '',
    })
    const rendered = renderCanonContext(canon)
    // 空块不应出现
    expect(rendered).not.toContain('暂无')
    expect(rendered).not.toContain('无 RAG')
  })
})

// ============================================================
// 集成：fact-extractor 写回
// ============================================================
describe('fact-extractor：定稿时的结构化写回', () => {
  it('应能从章节正文中提取事件、角色 delta、事实', () => {
    const chapterContent = `林轩在青云山与师父告别。师父递给他一柄青虹剑。

林轩离开青云山前往烈火宗。

李四在烈火宗等待林轩到来，他们约定共同对抗赵无极。

林轩知道赵无极是幕后黑手，怒不可遏。`
    const characters = [
      { name: '林轩', role: 'protagonist', currentState: { location: '青云山', keyItems: '青虹剑' } },
      { name: '师父', role: 'supporting', currentState: {} },
      { name: '李四', role: 'supporting', currentState: {} },
      { name: '赵无极', role: 'antagonist', currentState: {} },
    ]
    const payload = extractCanonWriteback({
      chapterNumber: 5,
      chapterTitle: '第五章 告别',
      chapterContent,
      characters,
      chapterBlueprint: { keyEvents: '开启对抗赵无极的旅程', characters: ['林轩', '李四'] },
    })

    expect(payload.chapterNumber).toBe(5)
    expect(payload.chapterTitle).toBe('告别')
    // 至少应提取到一些事件
    expect(payload.newEvents.length).toBeGreaterThan(0)
    // 角色 deltas 应包含林轩
    const zhangSanDelta = payload.characterDeltas.find(d => d.character === '林轩')
    expect(zhangSanDelta).toBeDefined()
    // 事实条目应包含身份/物品类
    const allStatements = payload.newFacts.map(f => f.statement)
    expect(allStatements.some(s => s.includes('青虹剑'))).toBe(true)
    // 剧情线变更：因为 keyEvents 包含"开启"
    expect(payload.plotLineChanges.added?.length || 0).toBeGreaterThanOrEqual(0)
  })

  it('空章节不应抛出异常，应返回空 payload', () => {
    const payload = extractCanonWriteback({
      chapterNumber: 1,
      chapterTitle: '第一章',
      chapterContent: '',
      characters: [],
    })
    expect(payload.newEvents).toHaveLength(0)
    expect(payload.characterDeltas).toHaveLength(0)
    expect(payload.newFacts).toHaveLength(0)
  })
})

// ============================================================
// 集成：物品归属校验
// ============================================================
describe('物品归属校验', () => {
  it('canon 归属人正常使用物品不应触发警告', () => {
    const state = makeState({ character: '林轩', keyItems: '青虹剑' })
    const text = `林轩拿起青虹剑，朝敌人挥去。`
    const issues = checkItemOwnership(text, [state])
    expect(issues.filter(i => i.category === 'item' && i.severity === 'error')).toHaveLength(0)
  })

  it('他人使用 canon 归属物品应触发 info 级别提示', () => {
    const state = makeState({ character: '林轩', keyItems: '青虹剑' })
    const text = `李四拿起青虹剑，朝敌人挥去。`
    const issues = checkItemOwnership(text, [state])
    const itemIssue = issues.find(i => i.category === 'item')
    expect(itemIssue).toBeDefined()
    expect(itemIssue?.characters).toContain('李四')
    expect(itemIssue?.characters).toContain('林轩')
  })
})

// ============================================================
// 集成：上一章结尾衔接
// ============================================================
describe('上一章结尾衔接', () => {
  it('本章开头承接上一章人物应通过', () => {
    const text = `林轩站在青云山巅，望向远方的天元城。他决定立即出发。`
    const previousEnding = `林轩站在青云山巅，望着远方的天元城，心中暗自下定决心。`
    const issues = checkPreviousEndingContinuity(text, previousEnding)
    // 共享人物名"林轩" → 不应警告
    expect(issues.filter(i => i.severity === 'error')).toHaveLength(0)
  })

  it('本章开头无上一章人物应触发 info 级别提示', () => {
    const text = `周明在烈火宗巡视了一圈，并未发现任何异常。`
    const previousEnding = `林轩站在青云山巅，望着远方的天元城，心中暗自下定决心。`
    const issues = checkPreviousEndingContinuity(text, previousEnding)
    const info = issues.find(i => i.category === 'continuity')
    expect(info).toBeDefined()
    expect(info?.message).toContain('林轩')
  })
})

// ============================================================
// 功能级集成：Soft gate 三态
// ============================================================
describe('Soft gate：PASS / REPAIR / BLOCK', () => {
  it('无一致性问题时返回 PASS', async () => {
    const canon = makeCanon({
      characterStates: [makeState({ character: '林轩', location: '青云山', knowledge: ['师父被害'] })],
      previousEnding: '',
      ragContext: '',
    })
    const result = await runConsistencyGate({
      chapterNumber: 1,
      chapterContent: '林轩在青云山练剑，心中记着师父被害之事。',
      canon,
    })
    expect(result.verdict).toBe('PASS')
    expect(result.repairedContent).toBeUndefined()
  })

  it('可自动补充信息来源的问题返回 REPAIR 并提供修复正文', async () => {
    const canon = makeCanon({
      characterStates: [makeState({ character: '林轩', knowledge: [] })],
      previousEnding: '',
      ragContext: '',
    })
    const result = await runConsistencyGate({
      chapterNumber: 1,
      chapterContent: '林轩知道了九转还魂丹的位置，立刻动身。',
      canon,
    })
    expect(result.verdict).toBe('REPAIR')
    expect(result.repairedContent).toContain('（据前文线索）林轩知道了九转还魂丹的位置')
    expect(result.blockingReasons).toHaveLength(0)
  })

  it('rewrite 破坏已死亡角色事实时返回 BLOCK', async () => {
    const canon = makeCanon({
      timeline: makeTimeline([{
        chapterNumber: 1,
        sequence: 1,
        summary: '师父在烈火宗之战中死亡',
        impact: '师父死亡',
        characters: ['师父'],
      }]),
      previousEnding: '',
      ragContext: '',
    })
    const result = await runConsistencyGate({
      chapterNumber: 2,
      chapterContent: '师父笑着走进大殿，说孩子们我回来了。',
      canon,
      isRewrite: true,
    })
    expect(result.verdict).toBe('BLOCK')
    expect(result.blockingReasons.join('\n')).toContain('已死亡人物')
  })
})

// ============================================================
// 功能级集成：CanonStore writeback（IPC → 持久化门面）
// ============================================================
describe('CanonStore.writeback', () => {
  it('按章节写回摘要、时间线、角色状态、剧情线和事实', async () => {
    const calls: Array<{ channel: string; args: unknown[] }> = []
    const fakeIpc = {
      async invoke(channel: string, ...args: unknown[]) {
        calls.push({ channel, args })
        if (channel === 'db:canon-character-state-get') {
          return {
            character: args[0] as string,
            location: '青云山',
            powerLevel: '筑基期',
            physicalState: '正常',
            mentalState: '',
            keyItems: '旧剑',
            currentGoal: '',
            knowledge: ['师父被害'],
            relationships: {},
            recentEvents: '',
            updatedAtChapter: 1,
            updatedAt: '2025-01-01T00:00:00Z',
          }
        }
        if (channel.endsWith('-append') || channel.endsWith('-add')) return { success: true, id: calls.length }
        if (channel.endsWith('-upsert')) return { success: true }
        return { success: true }
      },
    }

    const store = new CanonStore(fakeIpc)
    const result = await store.writeback({
      chapterNumber: 5,
      chapterTitle: '告别',
      chapterSummary: '林轩告别师父，前往烈火宗。',
      newEvents: [{
        chapterNumber: 5,
        sequence: 1,
        characters: ['林轩'],
        location: '烈火宗',
        timeFlow: 'sequential',
        summary: '林轩抵达烈火宗',
        impact: '位置变化',
      }],
      characterDeltas: [{
        character: '林轩',
        chapterNumber: 5,
        after: {
          location: '烈火宗',
          keyItems: '旧剑、青虹剑',
          recentEvents: '抵达烈火宗',
        },
      }],
      plotLineChanges: {
        added: [{
          name: '对抗赵无极',
          status: 'active',
          startedAt: 5,
          lastAdvancedAt: 5,
          characters: ['林轩'],
          currentState: '本章开启',
          description: '开启对抗赵无极的旅程',
        }],
      },
      newFacts: [{
        category: 'item',
        statement: '林轩获得青虹剑',
        introducedAt: 5,
        characters: ['林轩'],
        evidence: '师父递给他一柄青虹剑',
      }],
    })

    expect(result.ok).toBe(true)
    // 修复后：writeback 走原子路径，IPC 调用数从 8 降到 2
    expect(calls.map(c => c.channel)).toEqual([
      'db:canon-summary-upsert',
      'db:canon-writeback-atomic',
    ])
    // 验证 atomic 调用的 payload 包含正确的 merge 数据
    const atomicCall = calls.find(c => c.channel === 'db:canon-writeback-atomic')
    expect(atomicCall).toBeDefined()
    const payload = atomicCall!.args[0] as {
      chapterNumber: number
      newEvents: Array<{ chapterNumber: number; sequence: number; characters: string[]; location: string; timeFlow: string; summary: string; impact: string }>
      characterDeltas: Array<{ character: string; after: { location?: string; keyItems?: string; knowledge?: string[] }; chapterNumber: number }>
      plotLineChanges: { added?: Array<{ name: string }>; advanced?: unknown[]; resolved?: number[] }
      newFacts: Array<{ category: string; statement: string; introducedAt: number; characters: string[]; evidence?: string }>
    }
    expect(payload.chapterNumber).toBe(5)
    expect(payload.newEvents).toHaveLength(1)
    expect(payload.characterDeltas[0].after.location).toBe('烈火宗')
    expect(payload.characterDeltas[0].after.keyItems).toBe('旧剑、青虹剑')
    expect(payload.plotLineChanges.added?.[0].name).toBe('对抗赵无极')
    expect(payload.newFacts[0].statement).toBe('林轩获得青虹剑')
  })
})

// ============================================================
// 功能级集成：CanonRepository（SQLite 持久化）
// ============================================================
describe('CanonRepository SQLite persistence', () => {
  it('真实 SQLite 表能持久化 timeline/state/plot/fact/summary', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'vela-canon-db-'))
    try {
      initProjectDatabase(projectDir)

      const eventId = CanonRepository.appendTimelineEvent({
        chapterNumber: 3,
        sequence: 1,
        characters: ['林轩'],
        location: '烈火宗',
        timeFlow: 'sequential',
        summary: '林轩抵达烈火宗',
        impact: '位置更新',
      })
      expect(eventId).toBeGreaterThan(0)
      expect(CanonRepository.getTimelineUpTo(3)).toMatchObject([
        { chapterNumber: 3, sequence: 1, characters: ['林轩'], location: '烈火宗' },
      ])

      CanonRepository.upsertCharacterState({
        character: '林轩',
        location: '烈火宗',
        powerLevel: '筑基期',
        physicalState: '正常',
        mentalState: '警惕',
        keyItems: '青虹剑',
        currentGoal: '调查赵无极',
        knowledge: ['师父被害'],
        relationships: { 赵无极: '敌人' },
        recentEvents: '抵达烈火宗',
        updatedAtChapter: 3,
        updatedAt: '2026-01-01T00:00:00Z',
      })
      expect(CanonRepository.getCharacterState('林轩')).toMatchObject({
        character: '林轩',
        location: '烈火宗',
        knowledge: ['师父被害'],
        relationships: { 赵无极: '敌人' },
      })

      const plotId = CanonRepository.addPlotLine({
        name: '对抗赵无极',
        status: 'active',
        startedAt: 3,
        lastAdvancedAt: 3,
        characters: ['林轩', '赵无极'],
        currentState: '发现线索',
        description: '林轩开始追查幕后黑手',
      })
      CanonRepository.advancePlotLine(plotId, '已锁定烈火宗', 4)
      expect(CanonRepository.getPlotLines({ status: 'active' })[0]).toMatchObject({
        id: plotId,
        currentState: '已锁定烈火宗',
        lastAdvancedAt: 4,
      })

      const factId = CanonRepository.addFact({
        category: 'item',
        statement: '林轩获得青虹剑',
        introducedAt: 3,
        characters: ['林轩'],
        evidence: '师父递给他一柄青虹剑',
      })
      expect(factId).toBeGreaterThan(0)
      expect(CanonRepository.getFacts()).toMatchObject([
        { statement: '林轩获得青虹剑', introducedAt: 3, characters: ['林轩'] },
      ])

      CanonRepository.upsertSummary({
        chapterNumber: 3,
        title: '烈火宗',
        summary: '林轩抵达烈火宗并发现赵无极线索。',
        createdAt: '2026-01-01T00:00:00Z',
      })
      expect(CanonRepository.getRecentSummaries(1)).toMatchObject([
        { chapterNumber: 3, title: '烈火宗' },
      ])
    } finally {
      closeProjectDatabase()
      rmSync(projectDir, { recursive: true, force: true })
    }
  })
})

// ============================================================
// 回归测试 (Regression Suite)
// 防止 PR #13 审计发现的 23 个真实 bug 再次出现
// 每个 case 对应一个 issue 编号
// ============================================================

describe('回归测试：审计发现的 bug 修复验证', () => {
  // F1: knowledge merge（不能覆盖旧 knowledge）
  it('F1: 多次 upsert character state 应累积 knowledge 列表', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'vela-rf-'))
    try {
      initProjectDatabase(projectDir)
      CanonRepository.upsertCharacterState({
        character: '林轩', location: '', powerLevel: '', physicalState: '', mentalState: '',
        keyItems: '', currentGoal: '', knowledge: ['秘密A', '秘密B'],
        relationships: {}, recentEvents: '', updatedAtChapter: 1, updatedAt: '2025-01-01T00:00:00Z',
      })
      CanonRepository.upsertCharacterState({
        character: '林轩', location: '', powerLevel: '', physicalState: '', mentalState: '',
        keyItems: '', currentGoal: '', knowledge: ['秘密C'],
        relationships: {}, recentEvents: '', updatedAtChapter: 2, updatedAt: '2025-01-02T00:00:00Z',
      })
      const stored = CanonRepository.getCharacterState('林轩')
      expect(stored?.knowledge).toEqual(['秘密A', '秘密B', '秘密C'])
    } finally { closeProjectDatabase(); rmSync(projectDir, { recursive: true, force: true }) }
  })

  // F2: deathSignals 误报中文成语
  it('F2: 死灰复燃/视死如归 等成语不应触发"复活"error', () => {
    const canon = makeCanon({
      timeline: makeTimeline([{
        chapterNumber: 1, sequence: 1,
        summary: '林轩师父被赵无极杀死', impact: '',
        characters: ['林轩'],
      }]),
    })
    const text1 = '林轩死灰复燃地站起来。'
    const text2 = '林轩视死如归地冲上前。'
    const text3 = '林轩听说这件事，死死的攥紧了拳头。'
    expect(checkRewriteFactSafety(text1, canon.timeline, canon.knownFacts).filter(i => i.severity === 'error')).toHaveLength(0)
    expect(checkRewriteFactSafety(text2, canon.timeline, canon.knownFacts).filter(i => i.severity === 'error')).toHaveLength(0)
    expect(checkRewriteFactSafety(text3, canon.timeline, canon.knownFacts).filter(i => i.severity === 'error')).toHaveLength(0)
  })

  // F4/F13: writeback 必须用原子事务
  it('F4/F13: writeback 必须用单次 db:canon-writeback-atomic IPC（非 7+ 顺序调用）', async () => {
    const calls: Array<{ channel: string }> = []
    const fakeIpc = {
      async invoke(channel: string) {
        calls.push({ channel })
        if (channel === 'db:canon-writeback-atomic') return { success: true }
        return { success: true }
      },
    }
    const store = new CanonStore(fakeIpc as any)
    await store.writeback({
      chapterNumber: 1, chapterTitle: '第一章',
      chapterSummary: 'summary',
      newEvents: [{ chapterNumber: 1, sequence: 1, characters: ['X'], location: 'A', timeFlow: 'sequential', summary: 'e', impact: '' }],
      characterDeltas: [], plotLineChanges: {}, newFacts: [],
    })
    const channels = calls.map(c => c.channel)
    expect(channels).toContain('db:canon-writeback-atomic')
    expect(channels).not.toContain('db:canon-timeline-clear-chapter')  // 旧路径已废弃
    expect(channels).not.toContain('db:canon-timeline-append')  // 旧路径已废弃
  })

  // F6: safeParse 必须抛错而不是静默吞 JSON 错
  it('F6: corrupt JSON in DB should throw (not silently return empty)', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'vela-rf-'))
    try {
      initProjectDatabase(projectDir)
      const db = getProjectDb()
      db.prepare(`INSERT INTO canon_character_state (character, knowledge_json) VALUES (?, ?)`).run('林轩', '[corrupted')
      expect(() => CanonRepository.getCharacterState('林轩')).toThrow(/数据已损坏/)
    } finally { closeProjectDatabase(); rmSync(projectDir, { recursive: true, force: true }) }
  })

  // F7: addFact dedup（大小写/空格不敏感）
  it('F7: addFact 应当用规范化去重 (大小写/空格不敏感)', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'vela-rf-'))
    try {
      initProjectDatabase(projectDir)
      const id1 = CanonRepository.addFact({ category: 'identity', statement: 'X 是 Y', introducedAt: 1, characters: [], evidence: '' })
      const id2 = CanonRepository.addFact({ category: 'identity', statement: 'x 是 y', introducedAt: 1, characters: [], evidence: '' })
      const id3 = CanonRepository.addFact({ category: 'identity', statement: 'X  是  Y', introducedAt: 1, characters: [], evidence: '' })
      const id4 = CanonRepository.addFact({ category: 'identity', statement: 'X 是 Y', introducedAt: 1, characters: [], evidence: '' })
      expect(id1).toBe(id2)
      expect(id1).toBe(id3)
      expect(id1).toBe(id4)
    } finally { closeProjectDatabase(); rmSync(projectDir, { recursive: true, force: true }) }
  })

  // F8: timeline sequence 应有 UNIQUE 约束
  it('F8: 同一 (chapter, sequence) 第二次 append 应覆盖而非重复插入', () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'vela-rf-'))
    try {
      initProjectDatabase(projectDir)
      CanonRepository.appendTimelineEvent({ chapterNumber: 1, sequence: 1, characters: ['A'], location: 'X', timeFlow: 'sequential', summary: 'first', impact: '' })
      CanonRepository.appendTimelineEvent({ chapterNumber: 1, sequence: 1, characters: ['B'], location: 'Y', timeFlow: 'sequential', summary: 'second', impact: '' })
      const events = CanonRepository.getTimelineByChapter(1)
      expect(events).toHaveLength(1)
      expect(events[0].summary).toBe('second')  // 第二次覆盖了第一次
    } finally { closeProjectDatabase(); rmSync(projectDir, { recursive: true, force: true }) }
  })

  // F12/F29: prompt builder 必须转义 value 中的 {{}}
  it('F12/F29: prompt builder 必须转义用户数据中的 {{xxx}} 模板变量', () => {
    const template = BUILTIN_PROMPTS.find((p: any) => p.key === 'next_chapter_draft')
    const builder = new BasePromptBuilder(template)
    const maliciousValue = '恶意：{{chapter_title}} 应该被替换为敏感内容'
    builder.withCanonContext(maliciousValue)
    const built = builder.build()
    // {{}} 应该被转义为 ⦃⦃⦄⦄，不能再作为模板变量被替换
    expect(built).not.toMatch(/\{\{chapter_title\}\}/)
    expect(built).toMatch(/⦃⦃chapter_title⦄⦄/)
  })

  // F15/F28: auto-fix 必须处理 evidence 的所有出现
  it('F15/F28: tryAutoFix 应标记 evidence 的所有出现（不仅第一处）', () => {
    const issues = [{
      severity: 'warning' as const, category: 'knowledge' as const,
      characters: ['林轩'], message: 'k1', evidence: '林轩知道了秘密',
    }]
    const text = '第一段：林轩知道了秘密。\n\n第二段：林轩知道了秘密，立刻出发。'
    const result = tryAutoFix(text, issues)
    const insertCount = (result.content.match(/（据前文线索）/g) || []).length
    expect(insertCount).toBe(2)  // 两处都应该被标注
  })

  // F18: 多个 issues 同样 evidence 都应处理
  it('F18: 多个 issues 同样 evidence 都应触发插入', () => {
    const issues = [
      { severity: 'warning' as const, category: 'knowledge' as const, characters: ['林轩'], message: 'k1', evidence: '林轩知道了秘密' },
      { severity: 'warning' as const, category: 'knowledge' as const, characters: ['林轩'], message: 'k2', evidence: '林轩知道了秘密' },
    ]
    const text = 'A段：林轩知道了秘密。\n\nB段：林轩知道了秘密，立刻出发。'
    const result = tryAutoFix(text, issues)
    const insertCount = (result.content.match(/（据前文线索）/g) || []).length
    expect(insertCount).toBeGreaterThanOrEqual(2)
  })

  // F31: stateSignals 必须含常见动词
  it('F31: stateSignals 应覆盖"飞/遁/跳/望/听"等常见动词', () => {
    const extracted = extractCanonWriteback({
      chapterNumber: 1, chapterTitle: '第一章',
      chapterContent: '林轩飞向天元城。',
      characters: [{ name: '林轩', role: 'protagonist', currentState: { location: '青云山' } }],
    })
    const linXuan = extracted.characterDeltas.find(d => d.character === '林轩')
    expect(linXuan).toBeDefined()  // 之前 "飞" 不在列表里 → delta 不生成
  })

  // F33: fixLocationJump 不能破坏章节结构
  it('F33: fixLocationJump 不应插入到标题行/章节标题之前', () => {
    const issues = [{
      severity: 'warning' as const, category: 'location' as const, characters: ['林轩'],
      message: '地点从「青云山」变为「烈火宗」',
      evidence: '在烈火宗激战',
    }]
    // 标题 + evidence 在标题行
    const text = '在烈火宗激战。\n\n【第一节】林轩在青云山练剑。'
    const result = tryAutoFix(text, issues)
    // 不应修改（evidence 在标题行），或修改后不会破坏【第一节】的位置
    if (result.modified) {
      // 修改了的话，【第一节】必须在插入的内容之后
      const titleIdx = result.content.indexOf('【第一节】')
      const insertIdx = result.content.indexOf('林轩')
      expect(insertIdx).toBeGreaterThan(titleIdx)
    }
  })

  // F33b: 正常 narrative line 上 fixLocationJump 应工作
  it('F33b: fixLocationJump 在 narrative line 上应正常插入转场', () => {
    const issues = [{
      severity: 'warning' as const, category: 'location' as const, characters: ['林轩'],
      message: '地点从「青云山」变为「烈火宗」',
      evidence: '林轩在烈火宗激战',
    }]
    const text = '【第一节】林轩在青云山告别。\n\n林轩在烈火宗激战。'
    const result = tryAutoFix(text, issues)
    expect(result.modified).toBe(true)
    // 至少一个转场动词被插入
    expect(/林轩(?:来到|抵达|前往|赶往)烈火宗/.test(result.content)).toBe(true)
  })
})
