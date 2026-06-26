/**
 * Stability Controller (v5) — 稳定性优先叙事引擎
 *
 * 在 v4 语义一致性之上增加：
 *   - Stability Score — 四维稳定性评分（context/intent/entropy/noise）
 *   - Canon Snapshot — 每 N 章压缩全量 CanonContext 为快照
 *   - Output Stabilizer — 后处理平滑输出
 *
 * Stability modes:
 *   low (0-0.3)    → normal generation
 *   medium (0.3-0.6) → context compression (load snapshot)
 *   high (0.6-0.8) → canon snapshot rebuild
 *   critical (>0.8) → block generation
 */
import type {
  CharacterStateSnapshot,
  TimelineEvent,
  ChapterSummary,
} from './types'
import { canonStore } from './canon-store'

// ============================================================
// Stability Score
// ============================================================

export interface StabilityScore {
  overall: number
  dimensions: {
    contextDrift: number
    intentVariance: number
    characterEntropy: number
    timelineNoise: number
  }
  mode: 'normal' | 'compression' | 'rebuild' | 'critical'
  computedAt: string
}

// ============================================================
// 1. Context Drift — 角色状态变化率
// ============================================================

function computeContextDrift(
  characterStates: CharacterStateSnapshot[],
  _recentSummaries: ChapterSummary[],
): number {
  if (characterStates.length === 0) return 0

  // 统计最近 N 章中每个角色 location 变化的频率
  let totalChanges = 0
  const validChars = characterStates.filter(cs => cs.updatedAtChapter > 0)

  for (const cs of validChars) {
    // 若 updatedAtChapter 远小于最新章 → 说明该角色长期不变 → 贡献低 drift
    const latestChapter = Math.max(...validChars.map(c => c.updatedAtChapter), 1)
    const staleness = (latestChapter - cs.updatedAtChapter) / Math.max(latestChapter, 1)
    // stale 角色不贡献 drift
    if (staleness > 0.5) continue
    totalChanges += 1
  }

  const rate = validChars.length > 0 ? totalChanges / validChars.length : 0
  return Math.min(1, rate)
}

// ============================================================
// 2. Intent Variance — 角色目标变化幅度
// ============================================================

function computeIntentVariance(
  characterStates: CharacterStateSnapshot[],
): number {
  if (characterStates.length === 0) return 0

  let variance = 0
  for (const cs of characterStates) {
    const goal = cs.currentGoal?.trim()
    if (!goal || goal.length < 3) continue
    // 目标中包含"改变"、"转折"、"突变" → 高 variance
    const instabilityMarkers = ['改变', '突然', '不再', '放弃', '转而', '转折', '突变', '反转']
    const markerCount = instabilityMarkers.filter(m => goal.includes(m)).length
    variance += Math.min(1, markerCount / 3)
  }

  return characterStates.length > 0 ? variance / characterStates.length : 0
}

// ============================================================
// 3. Character Entropy — 新角色/事件密度
// ============================================================

function computeCharacterEntropy(
  timeline: TimelineEvent[],
  _chapterSummaries: ChapterSummary[],
  currentChapter: number,
): number {
  const window = 5
  const startChapter = Math.max(1, currentChapter - window)

  // 统计近 N 章中出现的新角色数
  const recentEvents = timeline.filter(e => e.chapterNumber >= startChapter && e.chapterNumber <= currentChapter)
  const allChars = new Set<string>()
  for (const ev of recentEvents) {
    for (const ch of ev.characters) {
      allChars.add(ch)
    }
  }

  // 统计更早期角色总数
  const priorEvents = timeline.filter(e => e.chapterNumber < startChapter)
  const priorChars = new Set<string>()
  for (const ev of priorEvents) {
    for (const ch of ev.characters) {
      priorChars.add(ch)
    }
  }

  // 新角色率
  const newChars = [...allChars].filter(c => !priorChars.has(c))
  const entropy = priorChars.size > 0 ? newChars.length / priorChars.size : newChars.length > 0 ? 0.5 : 0

  return Math.min(1, entropy * 2) // 放大因子，因为新角色引入本身不算高熵
}

// ============================================================
// 4. Timeline Noise — 事件密度方差
// ============================================================

function computeTimelineNoise(
  timeline: TimelineEvent[],
  currentChapter: number,
): number {
  const window = 10
  const startChapter = Math.max(1, currentChapter - window)

  const densityMap = new Map<number, number>()
  for (const ev of timeline) {
    if (ev.chapterNumber >= startChapter && ev.chapterNumber <= currentChapter) {
      densityMap.set(ev.chapterNumber, (densityMap.get(ev.chapterNumber) || 0) + 1)
    }
  }

  if (densityMap.size < 3) return 0

  const densities = Array.from(densityMap.values())
  const avg = densities.reduce((s, v) => s + v, 0) / densities.length
  if (avg === 0) return 0

  // 标准差 / 平均值 = 变异系数
  const variance = densities.reduce((s, v) => s + (v - avg) ** 2, 0) / densities.length
  const cv = Math.sqrt(variance) / avg

  return Math.min(1, cv)
}

// ============================================================
// Aggregate Score
// ============================================================

export function determineStabilityMode(score: number): StabilityScore['mode'] {
  if (score > 0.8) return 'critical'
  if (score > 0.6) return 'rebuild'
  if (score > 0.3) return 'compression'
  return 'normal'
}

export async function computeStabilityScore(
  currentChapter: number,
  characterStates: CharacterStateSnapshot[],
  timeline: TimelineEvent[],
): Promise<StabilityScore> {
  const summaries = await canonStore.getRecentSummaries(10)

  const contextDrift = computeContextDrift(characterStates, summaries)
  const intentVariance = computeIntentVariance(characterStates)
  const characterEntropy = computeCharacterEntropy(timeline, summaries, currentChapter)
  const timelineNoise = computeTimelineNoise(timeline, currentChapter)

  // 加权平均（context drift 权重最高）
  const overall = Math.round((
    contextDrift * 0.35 +
    intentVariance * 0.25 +
    characterEntropy * 0.20 +
    timelineNoise * 0.20
  ) * 100) / 100

  return {
    overall,
    dimensions: { contextDrift, intentVariance, characterEntropy, timelineNoise },
    mode: determineStabilityMode(overall),
    computedAt: new Date().toISOString(),
  }
}

// ============================================================
// Canon Snapshot System
// ============================================================

export interface CanonSnapshot {
  /** 快照覆盖的章节范围 */
  chapterRange: [number, number]
  /** 压缩后的角色状态 */
  compressedCharacters: string
  /** 压缩后的时间线 */
  compressedTimeline: string
  /** 关键事实 */
  keyFacts: string
  /** 长期目标 */
  longTermGoals: string
  /** 快照创建时间 */
  createdAt: string
}

/**
 * 从 Canon Store 生成压缩快照。
 * 每 N 章（默认 10）调用一次，替代长历史上下文。
 */
export async function generateCanonSnapshot(
  currentChapter: number,
  window = 10,
): Promise<CanonSnapshot> {
  const startChapter = Math.max(1, currentChapter - window)

  const [timeline, characterStates, _summaries, facts, plotLines] = await Promise.all([
    canonStore.getTimeline(currentChapter),
    canonStore.getAllCharacterStates(),
    canonStore.getRecentSummaries(window),
    canonStore.getFacts(),
    canonStore.getPlotLines(),
  ])

  // 压缩角色状态
  const compressedCharacters = characterStates
    .filter(cs => cs.updatedAtChapter >= startChapter)
    .map(cs => {
      const goal = cs.currentGoal ? `目标:${cs.currentGoal.slice(0, 30)}` : ''
      const loc = cs.location ? `@${cs.location}` : ''
      const mental = cs.mentalState ? `情绪:${cs.mentalState}` : ''
      return `[${cs.character}] ${loc} ${goal} ${mental}`.trim()
    })
    .join(' | ') || '（无活跃角色）'

  // 压缩时间线
  const compressedTimeline = timeline
    .filter(e => e.chapterNumber >= startChapter)
    .slice(-20)
    .map(e => `Ch${e.chapterNumber}.#${e.sequence}: ${e.summary.slice(0, 50)}`)
    .join('\n') || '（无近期事件）'

  // 关键事实
  const keyFacts = facts
    .slice(-15)
    .map(f => `[${f.category}] ${f.statement}`)
    .join(' | ') || '（无关键事实）'

  // 长期目标
  const longTermGoals = plotLines
    .filter(pl => pl.status === 'active')
    .map(pl => `[${pl.name}] ${pl.currentState.slice(0, 60)}`)
    .join('\n') || '（无活跃剧情线）'

  return {
    chapterRange: [startChapter, currentChapter],
    compressedCharacters,
    compressedTimeline,
    keyFacts,
    longTermGoals,
    createdAt: new Date().toISOString(),
  }
}

/**
 * 将快照渲染为 prompt 注入文本
 */
export function renderCanonSnapshot(snapshot: CanonSnapshot): string {
  return [
    `【CANON SNAPSHOT — 第${snapshot.chapterRange[0]}-${snapshot.chapterRange[1]}章压缩快照】`,
    '',
    '## 活跃角色',
    snapshot.compressedCharacters,
    '',
    '## 近期关键事件',
    snapshot.compressedTimeline,
    '',
    '## 关键事实',
    snapshot.keyFacts,
    '',
    '## 长期目标',
    snapshot.longTermGoals,
  ].join('\n')
}

// ============================================================
// Output Stabilizer — 后处理平滑
// ============================================================

export interface StabilizeResult {
  content: string
  applied: boolean
  fixes: string[]
}

/**
 * 后处理平滑：修正轻微语义抖动和风格不一致。
 * 纯启发式，不调用 LLM。
 */
export function stabilizeOutput(
  content: string,
  _characterStates: CharacterStateSnapshot[],
): StabilizeResult {
  let working = content
  const fixes: string[] = []

  // 1. 角色名一致性：统一简繁/别名
  // 不做替换，只记录潜在问题

  // 2. 去除过度的感叹号（3+连续）→ max 2
  const exclamationFixed = working.replace(/！{3,}/g, '！！')
  if (exclamationFixed !== working) {
    fixes.push('去除连续感叹号')
    working = exclamationFixed
  }

  // 3. 去除连续省略号 （4+点）→ ...
  const ellipsisFixed = working.replace(/。{4,}/g, '...')
  if (ellipsisFixed !== working) {
    fixes.push('规范省略号')
    working = ellipsisFixed
  }

  // 4. 段落长度均衡：合并过短段落（< 10 字符）
  const paragraphs = working.split(/\n+/)
  const merged: string[] = []
  let buffer = ''
  for (const p of paragraphs) {
    const trimmed = p.trim()
    if (!trimmed) {
      if (buffer) { merged.push(buffer); buffer = '' }
      merged.push('')
      continue
    }
    if (trimmed.length < 10 && buffer) {
      buffer += trimmed
    } else if (trimmed.length < 10) {
      buffer = trimmed
    } else {
      if (buffer) { merged.push(buffer); buffer = '' }
      merged.push(trimmed)
    }
  }
  if (buffer) merged.push(buffer)
  const mergedContent = merged.join('\n\n')
  if (mergedContent !== working) {
    fixes.push('合并过短段落')
    working = mergedContent
  }

  // 5. 首尾一致：确保章节以合理方式结束
  const lastSentence = working.split(/[。！？]/).filter(s => s.trim().length > 3).pop() || ''
  if (lastSentence.length < 5 && working.length > 200) {
    fixes.push('结尾过短，可能被截断')
  }

  return {
    content: working,
    applied: fixes.length > 0,
    fixes,
  }
}

/**
 * 生成稳定性报告的人类可读文本
 */
export function formatStabilityReport(score: StabilityScore): string {
  const modeLabels: Record<StabilityScore['mode'], string> = {
    normal: '🟢 正常生成',
    compression: '🟡 上下文压缩模式',
    rebuild: '🟠 快照重建模式',
    critical: '🔴 阻止生成',
  }

  return [
    `📊 稳定性报告（overall ${score.overall} — ${modeLabels[score.mode]}）`,
    `  contextDrift:    ${score.dimensions.contextDrift.toFixed(2)}`,
    `  intentVariance:  ${score.dimensions.intentVariance.toFixed(2)}`,
    `  characterEntropy:${score.dimensions.characterEntropy.toFixed(2)}`,
    `  timelineNoise:   ${score.dimensions.timelineNoise.toFixed(2)}`,
  ].join('\n')
}
