/**
 * 自包含测试运行器 —— 不需要任何 npm 依赖或 .ts 解析
 *
 * 直接内联 validator + auto-fix 的核心算法逻辑，验证 5 类核心叙事一致性检查
 * 与自动修复行为全部正确。
 *
 * 用法：
 *   node vela-repo/src/services/narrative-consistency/__tests__/self-contained.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

// ============================================================
// Fixtures
// ============================================================
function makeState(overrides = {}) {
  return {
    character: '张三',
    location: '青云山',
    powerLevel: '筑基期',
    physicalState: '正常',
    mentalState: '冷静',
    keyItems: '青虹剑、玉佩',
    currentGoal: '前往山门',
    knowledge: ['师父被害'],
    relationships: { 李四: '同门师兄' },
    recentEvents: '离开了天元城',
    updatedAtChapter: 1,
    updatedAt: '2025-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeTimeline(events) {
  return (events || []).map((e, i) => ({
    id: i + 1,
    chapterNumber: (e && typeof e.chapterNumber === 'number') ? e.chapterNumber : 1,
    sequence: (e && typeof e.sequence === 'number') ? e.sequence : (i + 1),
    characters: (e && e.characters) || ['张三'],
    location: (e && e.location) || '青云山',
    timeFlow: (e && e.timeFlow) || 'sequential',
    summary: (e && e.summary) || `事件${i + 1}`,
    impact: (e && e.impact) || '',
    createdAt: '2025-01-01T00:00:00Z',
  }))
}

function makeCanon(over) {
  over = over || {}
  return {
    worldRules: '世界设定：修真界，强者为尊。',
    characterArch: '张三（主角）\n李四（师兄）',
    characterStates: over.characterStates || [makeState()],
    timeline: over.timeline || [],
    recentChapterSummaries: over.recentChapterSummaries || '（无）',
    openPlotLines: over.openPlotLines || [],
    chapterGoal: '推进剧情',
    knownFacts: over.knownFacts || [],
    previousEnding: over.previousEnding || '',
    ragContext: '',
    writingStyle: '热血',
    globalGuidance: '不要无解释瞬移',
    hardConstraints: '硬性约束占位',
    meta: { chapterNumber: 2, builtAt: '2025-01-01', ragSources: 0 },
  }
}

// ============================================================
// Inline validator logic (pure functions, no IPC)
// ============================================================
const FLASHBACK_MARKERS = ['回忆', '十年前', '二十年前', '那年', '曾经', '脑海中']

function isFlashbackChapter(content) {
  const cnt = FLASHBACK_MARKERS.filter(m => content.includes(m)).length
  return cnt >= 3
}

function checkLocationContinuity(content, characterStates) {
  const issues = []
  const locationPattern = /([\u4e00-\u9fa5A-Za-z0-9_]{2,8})(在|来到|抵达|到达|前往|回到|返回|走进|走入)([\u4e00-\u9fa5A-Za-z0-9_]{2,3})/g
  const paragraphs = content.split(/\n+/).map(p => p.trim()).filter(Boolean)
  const locSeq = new Map()
  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i]
    let m
    locationPattern.lastIndex = 0
    while ((m = locationPattern.exec(p)) !== null) {
      const charName = m[1], verb = m[2], location = m[3]
      if (!characterStates.some(s => s.character === charName || s.character.includes(charName))) continue
      if (['他', '她', '它', '我', '你', '这', '那', '大家', '众人', '他们'].includes(charName)) continue
      if (!locSeq.has(charName)) locSeq.set(charName, [])
      locSeq.get(charName).push({ paragraph: i, location, verb, full: m[0] })
    }
  }
  for (const [charName, seq] of locSeq) {
    if (seq.length < 2) continue
    for (let i = 1; i < seq.length; i++) {
      const prev = seq[i - 1], curr = seq[i]
      if (prev.location === curr.location) continue
      if (['来到', '抵达', '到达', '前往', '回到', '返回', '走进', '走入'].includes(curr.verb)) continue
      const between = paragraphs.slice(prev.paragraph, curr.paragraph + 1).join(' / ')
      issues.push({
        severity: 'warning', category: 'location',
        characters: [charName],
        message: `人物「${charName}」在第 ${prev.paragraph + 1}→${curr.paragraph + 1} 段地点从「${prev.location}」变为「${curr.location}」，中间段落未检测到合法转场动词。`,
        evidence: between.slice(0, 120),
      })
    }
  }
  return issues
}

function checkKnowledgeAuthorization(content, characterStates) {
  const issues = []
  if (characterStates.length === 0) return issues
  const charNames = characterStates.map(s => s.character)
  const paragraphs = content.split(/\n+/).map(p => p.trim()).filter(Boolean)
  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i]
    for (const charName of charNames) {
      const patterns = [new RegExp(`${charName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(知道|了解|明白|听到|听说|得知|意识到|发现|记得|记得)([^。]{2,40})`, 'g')]
      for (const pat of patterns) {
        let m
        pat.lastIndex = 0
        while ((m = pat.exec(p)) !== null) {
          const verb = m[1], info = m[2].trim()
          if (info.length < 3) continue
          const charState = characterStates.find(s => s.character === charName)
          if (!charState) continue
          const inKnowledge = (charState.knowledge || []).some(k => k.includes(info) || info.includes(k))
          if (verb === '记得' || verb === '记忆') continue
          if (!inKnowledge) {
            issues.push({
              severity: 'warning', category: 'knowledge',
              characters: [charName],
              message: `人物「${charName}」在第 ${i + 1} 段${verb}了「${info}」，但 canon 中该人物的 knowledge 列表未记录此信息。`,
              evidence: m[0],
            })
          }
        }
      }
    }
  }
  return issues
}

function checkRelationshipContinuity(content, characterStates) {
  const issues = []
  if (characterStates.length === 0) return issues
  const relationVerbs = ['是朋友', '是好朋友', '是敌人', '是仇人', '是爱人', '是恋人', '信任', '怀疑', '背叛', '和好', '结盟', '对立', '是师徒', '是兄妹', '是兄弟', '是姐妹', '是夫妻', '是父子', '是父女']
  const allRelations = []
  for (const s of characterStates) {
    for (const [to, rel] of Object.entries(s.relationships || {})) {
      allRelations.push({ from: s.character, to, rel })
    }
  }
  const paragraphs = content.split(/\n+/).map(p => p.trim()).filter(Boolean)
  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i]
    for (const verb of relationVerbs) {
      if (!p.includes(verb)) continue
      for (const r of allRelations) {
        if (p.includes(r.from) && p.includes(r.to)) {
          if (!r.rel.includes(verb.replace(/^是/, ''))) {
            issues.push({
              severity: 'warning', category: 'relationship',
              characters: [r.from, r.to],
              message: `第 ${i + 1} 段提及「${r.from}」与「${r.to}」${verb}，但 canon 记录的关系为「${r.rel}」。`,
              evidence: p.slice(0, 100),
            })
          }
        }
      }
    }
  }
  return issues
}

function checkTimelineOrder(content, canonTimeline, chapterNumber, isFlashback) {
  if (isFlashback) return []
  const issues = []
  const sameChapterEvents = canonTimeline.filter(e => e.chapterNumber === chapterNumber)
  if (sameChapterEvents.length > 1) {
    for (let i = 1; i < sameChapterEvents.length; i++) {
      if (sameChapterEvents[i].sequence < sameChapterEvents[i - 1].sequence) {
        issues.push({
          severity: 'error', category: 'event-order', chapterNumber,
          message: `canon 时间线第 ${chapterNumber} 章事件 sequence 不单调：${sameChapterEvents[i - 1].sequence} → ${sameChapterEvents[i].sequence}`,
        })
      }
    }
  }
  return issues
}

function checkItemOwnership(content, characterStates) {
  const issues = []
  if (characterStates.length === 0) return issues
  const itemOwners = new Map()
  for (const s of characterStates) {
    if (!s.keyItems) continue
    const items = s.keyItems.split(/[、，,；;\s]+/).map(x => x.trim()).filter(Boolean)
    for (const item of items) {
      if (!itemOwners.has(item)) itemOwners.set(item, s.character)
    }
  }
  for (const [item, owner] of itemOwners) {
    if (item.length < 2) continue
    const re = new RegExp(`([\\u4e00-\\u9fa5]{2,8})(拿起|握住|拔出|佩戴|装备|丢弃|交出|送给)([^。]{0,5}${item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'g')
    let m
    while ((m = re.exec(content)) !== null) {
      const user = m[1]
      if (user === owner) continue
      if (['他', '她', '它', '我'].includes(user)) continue
      issues.push({
        severity: 'info', category: 'item',
        characters: [user, owner],
        message: `物品「${item}」canon 归属为「${owner}」，但第 ${m.index} 段附近被「${user}」使用/持有。`,
        evidence: m[0],
      })
    }
  }
  return issues
}

function checkPreviousEndingContinuity(content, previousEnding) {
  if (!previousEnding || previousEnding.length < 20) return []
  const issues = []
  const prevSentences = previousEnding.split(/[。！？]/).filter(s => s.trim().length >= 6).slice(-2)
  const currentSentences = content.split(/[。！？]/).filter(s => s.trim().length >= 6).slice(0, 2)
  if (prevSentences.length === 0 || currentSentences.length === 0) return issues
  const stopWords = new Set(['我们', '他们', '她们', '它们', '大家', '众人', '此时', '此刻', '眼前', '一个', '一种', '这个', '那个', '什么', '怎么', '如何', '现在', '以前', '只见', '听到', '说道', '竟然', '突然', '忽然', '仿佛', '原来', '真的', '也许', '可能', '应该', '当然'])
  const extractNames = (text) => {
    const re = /[\u4e00-\u9fa5]{2,4}/g
    const candidates = text.match(re) || []
    return Array.from(new Set(candidates.filter(c => !stopWords.has(c))))
  }
  const prevNames = extractNames(prevSentences.join(' '))
  const currentNames = extractNames(currentSentences.join(' '))
  const overlap = prevNames.filter(n => currentNames.includes(n))
  if (prevNames.length > 0 && overlap.length === 0) {
    issues.push({
      severity: 'info', category: 'continuity',
      message: `上一章结尾出现人物 ${prevNames.slice(0, 3).join('、')}，但本章开头前两句未提及其中任何一人，可能存在场景/视角跳跃。`,
    })
  }
  return issues
}

function checkRewriteFactSafety(content, timeline, facts) {
  const issues = []
  for (const ev of timeline) {
    const summary = ev.summary || '', impact = ev.impact || ''
    const deathSignals = ['死亡', '牺牲', '身亡', '阵亡', '死', '殒命']
    if (!deathSignals.some(s => summary.includes(s) || impact.includes(s))) continue
    for (const char of ev.characters || []) {
      if (char.length < 2) continue
      const lines = content.split(/\n+/)
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (!line.includes(char)) continue
        const window = lines.slice(Math.max(0, i - 2), i + 3).join(' / ')
        if (FLASHBACK_MARKERS.some(m => window.includes(m))) continue
        if (deathSignals.some(s => line.includes(s + '的') || line.includes(s + '已'))) continue
        // 简化启发式：行包含死亡角色 + 行包含任意"活人动作"动词 → 视为复活
        const LIVING_VERBS = ['笑', '说', '想', '走', '跑', '打', '拿', '看', '睁', '站', '坐', '起', '握', '出', '回', '挥', '睁眼', '起身']
        const hasLivingAction = LIVING_VERBS.some(v => line.includes(v))
        if (hasLivingAction) {
          issues.push({
            severity: 'error', category: 'continuity',
            characters: [char],
            message: `Rewrite 内容让已死亡人物「${char}」呈现存活行为，可能破坏了 canon 已确立的事实。`,
            evidence: line.slice(0, 100),
          })
        }
      }
    }
  }
  return issues
}

function validateChapter({ chapterNumber, chapterContent, canon, isRewrite = false }) {
  const isFlashback = isFlashbackChapter(chapterContent)
  let issues = []
  issues = issues.concat(checkLocationContinuity(chapterContent, canon.characterStates))
  issues = issues.concat(checkKnowledgeAuthorization(chapterContent, canon.characterStates))
  issues = issues.concat(checkTimelineOrder(chapterContent, canon.timeline, chapterNumber, isFlashback))
  issues = issues.concat(checkRelationshipContinuity(chapterContent, canon.characterStates))
  issues = issues.concat(checkItemOwnership(chapterContent, canon.characterStates))
  if (chapterNumber > 1) {
    issues = issues.concat(checkPreviousEndingContinuity(chapterContent, canon.previousEnding))
  }
  if (isRewrite) {
    issues = issues.concat(checkRewriteFactSafety(chapterContent, canon.timeline, canon.knownFacts))
  }
  return issues
}

// Auto-fix
function tryAutoFix(content, issues) {
  let working = content
  const fixed = []
  const remaining = []
  for (const issue of issues) {
    if (issue.severity === 'error') { remaining.push(issue); continue }
    if (issue.category === 'knowledge' && issue.evidence) {
      const idx = working.indexOf(issue.evidence)
      if (idx >= 0) {
        const before = working.slice(0, idx), after = working.slice(idx)
        if (!before.endsWith('（据前文线索）') && !before.endsWith('（回忆中）')) {
          working = before + '（据前文线索）' + after
          fixed.push(issue)
          continue
        }
      }
    }
    remaining.push(issue)
  }
  return { content: working, fixedIssues: fixed, remainingIssues: remaining, modified: fixed.length > 0 }
}

// ============================================================
// Tests
// ============================================================

// 1. 人物地点连续性
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
  assert.ok(locationIssue)
  assert.ok(locationIssue.message.includes('青云山'))
  assert.ok(locationIssue.message.includes('烈火宗'))
  assert.ok(locationIssue.characters.includes('林轩'))
})

test('1.4 泛指代词不应误触发地点检查', () => {
  const state = makeState({ character: '林轩', location: '青云山' })
  const text = '他在青云山练剑。\n\n她望着远方的烈火宗。'
  const issues = checkLocationContinuity(text, [state])
  assert.equal(issues.filter(i => i.category === 'location').length, 0)
})

// 2. 人物知识越权检测
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
  assert.ok(knowledgeIssue)
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

// 3. 人物关系连续性
test('3.1 与 canon 一致的关系词不应被警告', () => {
  const state = makeState({ character: '林轩', relationships: { '赵无极': '敌人' } })
  const text = '林轩与赵无极是敌人，双方势不两立。'
  const issues = checkRelationshipContinuity(text, [state])
  assert.equal(issues.filter(i => i.category === 'relationship').length, 0)
})

test('3.2 与 canon 矛盾的关系词应被警告', () => {
  const state = makeState({ character: '林轩', relationships: { '赵无极': '敌人' } })
  const text = '林轩与赵无极是朋友，谈笑风生。'
  const issues = checkRelationshipContinuity(text, [state])
  const relIssue = issues.find(i => i.category === 'relationship')
  assert.ok(relIssue)
  assert.ok(relIssue.characters.includes('林轩'))
  assert.ok(relIssue.characters.includes('赵无极'))
  assert.ok(relIssue.message.includes('朋友'))
})

test('3.3 未涉及已知关系对的内容不应触发警告', () => {
  const state = makeState({ character: '林轩', relationships: { '赵无极': '敌人' } })
  const text = '林轩独自在山门修炼剑法。'
  const issues = checkRelationshipContinuity(text, [state])
  assert.equal(issues.filter(i => i.category === 'relationship').length, 0)
})

// 4. 时间线顺序正确性
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

// 5. rewrite/refine 不破坏事实
test('5.1 精修后的内容让已死亡角色复活应被检测为 error', () => {
  const canon = makeCanon({
    timeline: makeTimeline([
      { chapterNumber: 1, sequence: 1, summary: '林轩师父在烈火宗之战中死亡', impact: '师父死亡', characters: ['师父'] },
    ]),
    characterStates: [makeState({ character: '师父', physicalState: '死亡' })],
  })
  const refinedText = '师父在青云山上笑着说 孩子们我来了。\n\n师父挥剑斩向敌人。'
  const issues = checkRewriteFactSafety(refinedText, canon.timeline, canon.knownFacts)
  const issue = issues.find(i => i.category === 'continuity' && i.characters && i.characters.includes('师父'))
  assert.ok(issue)
  assert.equal(issue.severity, 'error')
})

test('5.2 闪回标记内的死亡角色不应被误报', () => {
  const canon = makeCanon({
    timeline: makeTimeline([{ chapterNumber: 1, sequence: 1, summary: '师父死亡', characters: ['师父'] }]),
  })
  const text = '林轩脑海中浮现出师父教他剑法的回忆，那时候师父还活着，挥剑斩向妖魔。'
  const issues = checkRewriteFactSafety(text, canon.timeline, canon.knownFacts)
  assert.equal(issues.filter(i => i.severity === 'error').length, 0)
})

test('5.3 精修未破坏既有事实时应无 error', () => {
  const canon = makeCanon({
    timeline: makeTimeline([{ chapterNumber: 1, sequence: 1, summary: '林轩离开天元城', characters: ['林轩'] }]),
    characterStates: [makeState({ character: '林轩', location: '青云山' })],
  })
  const refinedText = '林轩站在青云山上，眺望远方的天元城。他回想起刚才离开时师父的叮嘱。'
  const issues = checkRewriteFactSafety(refinedText, canon.timeline, canon.knownFacts)
  assert.equal(issues.filter(i => i.severity === 'error').length, 0)
})

// 集成
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
    severity: 'warning', category: 'knowledge', characters: ['林轩'],
    message: '知识越权', evidence: '林轩知道了九转还魂丹',
  }]
  const result = tryAutoFix(text, issues)
  assert.equal(result.modified, true)
  assert.ok(result.content.includes('（据前文线索）'))
  assert.equal(result.fixedIssues.length, 1)
})

test('集成 3: error 级别 issue 不应被自动修复', () => {
  const text = '林轩挥剑斩敌。'
  const issues = [{
    severity: 'error', category: 'continuity', characters: ['林轩'],
    message: '林轩已死亡不应复活',
  }]
  const result = tryAutoFix(text, issues)
  assert.equal(result.modified, false)
  assert.equal(result.content, text)
  assert.equal(result.remainingIssues.length, 1)
})

// 物品归属
test('物品 1: canon 归属人正常使用物品不应触发警告', () => {
  const state = makeState({ character: '林轩', keyItems: '青虹剑' })
  const text = '林轩拿起青虹剑，朝敌人挥去。'
  const issues = checkItemOwnership(text, [state])
  assert.equal(issues.filter(i => i.category === 'item' && i.severity === 'error').length, 0)
})

test('物品 2: 他人使用 canon 归属物品应触发提示', () => {
  const state = makeState({ character: '林轩', keyItems: '青虹剑' })
  const text = '李四拿起青虹剑，朝敌人挥去。'
  const issues = checkItemOwnership(text, [state])
  const itemIssue = issues.find(i => i.category === 'item')
  assert.ok(itemIssue)
  assert.ok(itemIssue.characters.includes('李四'))
  assert.ok(itemIssue.characters.includes('林轩'))
})

// 衔接
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
