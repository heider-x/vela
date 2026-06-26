/**
 * 独立 Node test 入口（纯 JS，不依赖任何 npm 包）
 *
 * 测试 validator/auto-fix/fact-extractor/context-builder 的核心逻辑。
 * canon-store 由于依赖 Electron IPC，在此处使用 stub 替代。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeState, makeCanon, makeTimeline, makePlotLines, makeFacts } from './fixtures.js'

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
  renderCanonContext,
  extractCanonWriteback,
} from '../index.js'

// ============================================================
// 1. 人物地点连续性
// ============================================================
test('1.1 合法转场（来到/前往/到达）不应被报告', () => {
  const state = makeState({ character: '林轩', location: '青云山' })
  const text = '林轩站在山门之外。\n\n林轩来到大殿之中。\n\n林轩走到师父面前。'
  const issues = checkLocationContinuity(text, [state])
  assert.equal(issues.filter(i => i.category === 'location').length, 0)
})

test('1.2 同一地点不应触发瞬移警告', () => {
  const state = makeState({ character: '林轩', location: '青云山' })
  const text = '林轩在青云山练剑。\n\n林轩在青云山打坐。\n\n林轩在青云山眺望。'
  const issues = checkLocationContinuity(text, [state])
  assert.equal(issues.filter(i => i.category === 'location').length, 0)
})

test('1.3 无解释的地点瞬移应被报告为 warning', () => {
  const state = makeState({ character: '林轩', location: '青云山' })
  const text = '林轩在青云山与师父告别。\n\n山门外飞雪漫天。\n\n林轩在烈火宗与人激战。'
  const issues = checkLocationContinuity(text, [state])
  assert.ok(issues.length > 0, 'should report at least one issue')
  const locationIssue = issues.find(i => i.category === 'location')
  assert.ok(locationIssue, 'location issue should exist')
  assert.ok(locationIssue.message.includes('青云山'), 'should mention original location')
  assert.ok(locationIssue.message.includes('烈火宗'), 'should mention new location')
  assert.ok(locationIssue.characters.includes('林轩'), 'should include character')
})

test('1.4 泛指代词不应误触发地点检查', () => {
  const state = makeState({ character: '林轩', location: '青云山' })
  const text = '他在青云山练剑。\n\n她望着远方的烈火宗。'
  const issues = checkLocationContinuity(text, [state])
  assert.equal(issues.filter(i => i.category === 'location').length, 0)
})

// ============================================================
// 2. 人物知识越权检测
// ============================================================
test('2.1 canon knowledge 列表中已有的信息不应被警告', () => {
  const state = makeState({ character: '林轩', knowledge: ['师父被害', '幕后黑手是赵无极'] })
  const text = '林轩知道了师父被害的真相，心中愤恨。'
  const issues = checkKnowledgeAuthorization(text, [state])
  assert.equal(issues.filter(i => i.category === 'knowledge').length, 0)
})

test('2.2 canon knowledge 中未记录的信息应被警告', () => {
  const state = makeState({ character: '林轩', knowledge: ['师父被害'] })
  const text = '林轩知道了九转还魂丹的下落，立刻动身前往。'
  const issues = checkKnowledgeAuthorization(text, [state])
  const knowledgeIssue = issues.find(i => i.category === 'knowledge')
  assert.ok(knowledgeIssue, 'knowledge issue should exist')
  assert.ok(knowledgeIssue.characters.includes('林轩'))
  assert.ok(knowledgeIssue.message.includes('九转还魂丹'))
})

test('2.3 记得/记忆 视为合法回忆（不警告）', () => {
  const state = makeState({ character: '林轩', knowledge: [] })
  const text = '林轩记得十年前的灭门惨案。'
  const issues = checkKnowledgeAuthorization(text, [state])
  assert.equal(issues.filter(i => i.category === 'knowledge').length, 0)
})

test('2.4 非人物名字不应被纳入检查', () => {
  const state = makeState({ character: '林轩', knowledge: [] })
  const text = '张三知道了秘密。'
  const issues = checkKnowledgeAuthorization(text, [state])
  assert.equal(issues.filter(i => i.category === 'knowledge').length, 0)
})

// ============================================================
// 3. 人物关系连续性
// ============================================================
test('3.1 与 canon 一致的关系词不应被警告', () => {
  const state = makeState({ character: '林轩', relationships: { 赵无极: '敌人' } })
  const text = '林轩与赵无极是敌人，双方势不两立。'
  const issues = checkRelationshipContinuity(text, [state])
  assert.equal(issues.filter(i => i.category === 'relationship').length, 0)
})

test('3.2 与 canon 矛盾的关系词应被警告', () => {
  const state = makeState({ character: '林轩', relationships: { 赵无极: '敌人' } })
  const text = '林轩与赵无极是朋友，谈笑风生。'
  const issues = checkRelationshipContinuity(text, [state])
  const relIssue = issues.find(i => i.category === 'relationship')
  assert.ok(relIssue)
  assert.ok(relIssue.characters.includes('林轩'))
  assert.ok(relIssue.characters.includes('赵无极'))
  assert.ok(relIssue.message.includes('朋友'))
})

test('3.3 未涉及已知关系对的内容不应触发警告', () => {
  const state = makeState({ character: '林轩', relationships: { 赵无极: '敌人' } })
  const text = '林轩独自在山门修炼剑法。'
  const issues = checkRelationshipContinuity(text, [state])
  assert.equal(issues.filter(i => i.category === 'relationship').length, 0)
})

// ============================================================
// 4. 时间线顺序正确性
// ============================================================
test('4.1 canon 中单调递增的 sequence 不应被警告', () => {
  const canon = makeCanon({
    timeline: makeTimeline([
      { chapterNumber: 2, sequence: 1, summary: '进入大殿' },
      { chapterNumber: 2, sequence: 2, summary: '遇见师父' },
      { chapterNumber: 2, sequence: 3, summary: '得到任务' },
    ]),
  })
  const text = '林轩进入大殿，遇见师父，得到任务。'
  const issues = checkTimelineOrder(text, canon.timeline, 2, false)
  assert.equal(issues.filter(i => i.category === 'timeline' && i.severity === 'error').length, 0)
  assert.equal(issues.filter(i => i.category === 'event-order' && i.severity === 'error').length, 0)
})

test('4.2 canon 中 sequence 倒退应被检测为 error', () => {
  const canon = makeCanon({
    timeline: makeTimeline([
      { chapterNumber: 2, sequence: 1, summary: '进入大殿' },
      { chapterNumber: 2, sequence: 2, summary: '遇见师父' },
      { chapterNumber: 2, sequence: 1, summary: '错误：倒退' },
    ]),
  })
  const text = '一些文本'
  const issues = checkTimelineOrder(text, canon.timeline, 2, false)
  const orderIssue = issues.find(i => i.category === 'event-order' && i.severity === 'error')
  assert.ok(orderIssue)
  assert.ok(orderIssue.message.includes('sequence 不单调'))
})

test('4.3 闪回章节不应触发时间顺序检查', () => {
  const canon = makeCanon({
    timeline: makeTimeline([{ chapterNumber: 1, sequence: 1, summary: '事件1' }]),
  })
  const text = '林轩回忆起十年前的惨案，那时候他还只是个孩子。'
  const issues = checkTimelineOrder(text, canon.timeline, 2, true)
  assert.equal(issues.filter(i => i.severity === 'error').length, 0)
})

// ============================================================
// 5. rewrite/refine 不破坏事实
// ============================================================
test('5.1 精修后的内容让已死亡角色复活应被检测为 error', () => {
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
  const refinedText = '师父在青云山上笑着说："孩子们，我来了。"\n\n师父挥剑斩向敌人。'
  const issues = checkRewriteFactSafety(refinedText, canon.timeline, canon.knownFacts)
  const issue = issues.find(i => i.category === 'continuity' && i.characters && i.characters.includes('师父'))
  assert.ok(issue)
  assert.equal(issue.severity, 'error')
})

test('5.2 闪回标记内的死亡角色不应被误报', () => {
  const canon = makeCanon({
    timeline: makeTimeline([
      { chapterNumber: 1, sequence: 1, summary: '师父死亡', characters: ['师父'] },
    ]),
  })
  const text = '林轩脑海中浮现出师父教他剑法的回忆，那时候师父还活着，挥剑斩向妖魔。'
  const issues = checkRewriteFactSafety(text, canon.timeline, canon.knownFacts)
  assert.equal(issues.filter(i => i.severity === 'error').length, 0)
})

test('5.3 精修未破坏既有事实时应无 error', () => {
  const canon = makeCanon({
    timeline: makeTimeline([
      { chapterNumber: 1, sequence: 1, summary: '林轩离开天元城', characters: ['林轩'] },
    ]),
    characterStates: [makeState({ character: '林轩', location: '青云山' })],
  })
  const refinedText = '林轩站在青云山上，眺望远方的天元城。他回想起刚才离开时师父的叮嘱。'
  const issues = checkRewriteFactSafety(refinedText, canon.timeline, canon.knownFacts)
  assert.equal(issues.filter(i => i.severity === 'error').length, 0)
})

// ============================================================
// 集成：validateChapter + tryAutoFix
// ============================================================
test('集成 1: validateChapter 应聚合多个维度的 issue', () => {
  const canon = makeCanon({
    characterStates: [makeState({ character: '林轩', knowledge: ['师父被害'] })],
    timeline: makeTimeline([{ chapterNumber: 1, sequence: 1, summary: '事件' }]),
  })
  const text = '林轩在青云山与赵无极是朋友，谈笑风生。\n\n林轩知道了九转还魂丹的位置。\n\n林轩在烈火宗拔剑。'
  const issues = validateChapter({ chapterNumber: 2, chapterContent: text, canon, isRewrite: false })
  const categories = new Set(issues.map(i => i.category))
  assert.ok(categories.has('location'))
  assert.ok(categories.has('knowledge'))
})

test('集成 2: tryAutoFix 应对 knowledge leak 进行高置信度修复', () => {
  const text = '林轩知道了九转还魂丹的位置，立刻动身。'
  const issues = [{
    severity: 'warning',
    category: 'knowledge',
    characters: ['林轩'],
    message: '知识越权',
    evidence: '林轩知道了九转还魂丹',
  }]
  const result = tryAutoFix(text, issues)
  assert.equal(result.modified, true)
  assert.ok(result.content.includes('（据前文线索）'))
  assert.equal(result.fixedIssues.length, 1)
})

test('集成 3: error 级别 issue 不应被自动修复（保守策略）', () => {
  const text = '林轩挥剑斩敌。'
  const issues = [{
    severity: 'error',
    category: 'continuity',
    characters: ['林轩'],
    message: '林轩已死亡不应复活',
  }]
  const result = tryAutoFix(text, issues)
  assert.equal(result.modified, false)
  assert.equal(result.content, text)
  assert.equal(result.remainingIssues.length, 1)
})

// ============================================================
// 集成：renderCanonContext 输出顺序
// ============================================================
test('集成 4: renderCanonContext 应按指定顺序注入各块', () => {
  const canon = makeCanon({
    characterStates: [makeState({ character: '林轩' })],
    timeline: makeTimeline([{ chapterNumber: 1, sequence: 1, summary: '事件A' }]),
    openPlotLines: makePlotLines([{ name: '复仇之路' }]),
    knownFacts: makeFacts([{ statement: '林轩是主角' }]),
  })
  const rendered = renderCanonContext(canon)

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
    assert.ok(idx > lastIdx, `Block "${title}" should appear after previous block (idx ${idx} > lastIdx ${lastIdx})`)
    lastIdx = idx
  }
})

test('集成 5: 空字段块应被自动跳过', () => {
  const canon = makeCanon({
    characterStates: [],
    timeline: [],
    openPlotLines: [],
    knownFacts: [],
    previousEnding: '',
    ragContext: '',
  })
  const rendered = renderCanonContext(canon)
  assert.ok(!rendered.includes('暂无'))
  assert.ok(!rendered.includes('无 RAG'))
})

// ============================================================
// 集成：fact-extractor 写回
// ============================================================
test('集成 6: fact-extractor 应能从章节正文中提取事件、角色 delta、事实', () => {
  const chapterContent = '林轩在青云山与师父告别。师父递给他一柄青虹剑。\n\n林轩离开青云山前往烈火宗。\n\n李四在烈火宗等待林轩到来，他们约定共同对抗赵无极。\n\n林轩知道赵无极是幕后黑手，怒不可遏。'
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

  assert.equal(payload.chapterNumber, 5)
  assert.equal(payload.chapterTitle, '告别')
  assert.ok(Array.isArray(payload.newEvents))
  const zhangSanDelta = payload.characterDeltas.find(d => d.character === '林轩')
  assert.ok(zhangSanDelta)
  const allStatements = payload.newFacts.map(f => f.statement)
  assert.ok(Array.isArray(allStatements))
})

test('集成 7: 空章节不应抛出异常', () => {
  const payload = extractCanonWriteback({
    chapterNumber: 1,
    chapterTitle: '第一章',
    chapterContent: '',
    characters: [],
  })
  assert.equal(payload.newEvents.length, 0)
  assert.equal(payload.characterDeltas.length, 0)
  assert.equal(payload.newFacts.length, 0)
})

// ============================================================
// 物品归属校验
// ============================================================
test('物品 1: canon 归属人正常使用物品不应触发警告', () => {
  const state = makeState({ character: '林轩', keyItems: '青虹剑' })
  const text = '林轩拿起青虹剑，朝敌人挥去。'
  const issues = checkItemOwnership(text, [state])
  assert.equal(issues.filter(i => i.category === 'item' && i.severity === 'error').length, 0)
})

test('物品 2: 他人使用 canon 归属物品应触发 info 级别提示', () => {
  const state = makeState({ character: '林轩', keyItems: '青虹剑' })
  const text = '李四拿起青虹剑，朝敌人挥去。'
  const issues = checkItemOwnership(text, [state])
  const itemIssue = issues.find(i => i.category === 'item')
  assert.ok(itemIssue)
  assert.ok(itemIssue.characters.includes('李四'))
  assert.ok(itemIssue.characters.includes('林轩'))
})

// ============================================================
// 上一章结尾衔接
// ============================================================
test('衔接 1: 本章开头承接上一章人物应通过', () => {
  const text = '林轩站在青云山巅，望向远方的天元城。他决定立即出发。'
  const previousEnding = '林轩站在青云山巅，望着远方的天元城，心中暗自下定决心。'
  const issues = checkPreviousEndingContinuity(text, previousEnding)
  assert.equal(issues.filter(i => i.severity === 'error').length, 0)
})

test('衔接 2: 本章开头无上一章人物应触发提示', () => {
  const text = '周明在烈火宗巡视了一圈，并未发现任何异常。'
  const previousEnding = '林轩站在青云山巅，望着远方的天元城，心中暗自下定决心。'
  const issues = checkPreviousEndingContinuity(text, previousEnding)
  const info = issues.find(i => i.category === 'continuity')
  assert.ok(info)
})
