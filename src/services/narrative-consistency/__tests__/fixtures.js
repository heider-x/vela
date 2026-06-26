/**
 * 测试 fixtures —— 构造一个最小可用的 CanonContext（纯 JS 兼容）
 */
export function makeState(overrides = {}) {
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

export function makeTimeline(events) {
  return (events || []).map((e, i) => ({
    id: i + 1,
    chapterNumber: 1,
    sequence: i + 1,
    characters: (e && e.characters) || ['张三'],
    location: (e && e.location) || '青云山',
    timeFlow: (e && e.timeFlow) || 'sequential',
    summary: (e && e.summary) || `事件${i + 1}`,
    impact: (e && e.impact) || '',
    createdAt: '2025-01-01T00:00:00Z',
    ...e,
  }))
}

export function makePlotLines(lines) {
  return (lines || []).map((l, i) => ({
    id: i + 1,
    name: (l && l.name) || `剧情线${i + 1}`,
    status: (l && l.status) || 'active',
    startedAt: (l && l.startedAt) || 1,
    lastAdvancedAt: (l && l.lastAdvancedAt) || 1,
    characters: (l && l.characters) || ['张三'],
    currentState: (l && l.currentState) || '进行中',
    description: (l && l.description) || '',
  }))
}

export function makeFacts(facts) {
  return (facts || []).map((f, i) => ({
    id: i + 1,
    category: (f && f.category) || 'identity',
    statement: (f && f.statement) || '张三 是 主角',
    introducedAt: (f && f.introducedAt) || 1,
    characters: (f && f.characters) || ['张三'],
    evidence: f && f.evidence,
  }))
}

export function makeCanon(over) {
  over = over || {}
  return {
    worldRules: '世界设定：修真界，强者为尊。',
    characterArch: '张三（主角）\n李四（师兄）',
    characterStates: over.characterStates || [makeState()],
    timeline: over.timeline || [],
    recentChapterSummaries: over.recentChapterSummaries ?? '上一章摘要：林轩离开青云山。',
    openPlotLines: over.openPlotLines || [],
    chapterGoal: '推进剧情',
    knownFacts: over.knownFacts || [],
    previousEnding: over.previousEnding ?? '林轩站在青云山巅，望向远方。',
    ragContext: over.ragContext ?? 'RAG 参考：青云山位于北境。',
    writingStyle: '热血',
    globalGuidance: '不要无解释瞬移',
    hardConstraints: '硬性约束占位',
    meta: { chapterNumber: 2, builtAt: '2025-01-01', ragSources: 0 },
  }
}
