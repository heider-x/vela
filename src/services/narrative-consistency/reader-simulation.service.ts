/**
 * Reader Simulation Engine (v7) — 读者模拟驱动叙事系统
 *
 * 模拟读者阅读过程中的心理状态变化，用于优化：
 *   - 好奇心曲线（curiosity curve）
 *   - 情绪投入（emotional engagement）
 *   - 信息揭示节奏（payoff timing）
 *   - 持续阅读驱动力（reading momentum）
 *
 * Reader State Model:
 *   curiosity (0-1)          — 对后续剧情的好奇程度
 *   confusion (0-1)           — 理解成本（越低越好）
 *   emotionalEngagement (0-1) — 情绪投入度
 *   narrativeTrust (0-1)      — 对作者叙事的信任度
 *   attentionDecay (0-1)      — 注意力衰减率
 *   momentum (0-1)            — 持续阅读驱动力
 */
import type { CharacterStateSnapshot, TimelineEvent, PlotLine } from './types'
import { canonStore } from './canon-store'

// ============================================================
// Reader State
// ============================================================

export interface ReaderState {
  curiosity: number
  confusion: number
  emotionalEngagement: number
  narrativeTrust: number
  attentionDecay: number
  momentum: number
  chapterNumber: number
  computedAt: string
}

export interface ReaderHistory {
  states: ReaderState[]
  trending: {
    curiosity: 'rising' | 'stable' | 'falling'
    engagement: 'rising' | 'stable' | 'falling'
    momentum: 'rising' | 'stable' | 'falling'
  }
}

// ============================================================
// Curiosity Computation — 信息缺口检测
// ============================================================

const CURIOSITY_OPENERS = [
  '突然', '就在这时', '不料', '没想到', '谁知',
  '原来', '竟然', '难道', '莫非', '殊不知',
  '谜', '秘密', '真相', '隐藏', '暗中',
  '？', '……',
]

const CURIOSITY_PAYOFFS = [
  '原来如此', '终于', '明白了', '原来是这样',
  '真相大白', '水落石出', '答案', '揭晓',
  '知道了', '得知', '发现',
]

function computeCuriosity(content: string, timeline: TimelineEvent[]): number {
  if (!content || content.length < 100) return 0.5

  // 信息缺口 = 悬念标记数 - payoff 标记数
  const openers = CURIOSITY_OPENERS.filter(m => content.includes(m)).length
  const payoffs = CURIOSITY_PAYOFFS.filter(m => content.includes(m)).length

  // 理想比例：opener 略多（保持悬念），但 payoff 也有（读者有回报）
  const gap = openers - payoffs * 1.5 // payoff 权重更高
  const raw = Math.max(0, Math.min(1, (gap + 3) / 6)) // 归一化到 0-1

  // 事件密度也影响好奇心：3-7 事件/章 = 理想
  const chapterEvents = timeline.length
  const eventBonus = Math.min(0.2, Math.abs(chapterEvents - 5) / 25)

  return Math.min(1, Math.round((raw + eventBonus) * 100) / 100)
}

// ============================================================
// Confusion Computation — 理解成本
// ============================================================

function computeConfusion(content: string, characterStates: CharacterStateSnapshot[]): number {
  if (!content || content.length < 100) return 0.3

  // 角色数量过多 → 理解成本上升
  const charCount = characterStates.filter(cs => cs.character.length >= 2).length
  const charFactor = Math.min(1, (charCount - 3) / 10) // >3 角色开始增加

  // 段落过长 → 理解成本上升
  const paragraphs = content.split(/\n+/).filter(p => p.trim().length > 0)
  const longParagraphs = paragraphs.filter(p => p.length > 300)
  const paraFactor = Math.min(0.5, longParagraphs.length / paragraphs.length * 0.5)

  // 新名词密度（专有名词）
  const properNouns = (content.match(/[A-Z][a-z]+|[「『][^」』]{2,8}[」』]/g) || []).length
  const nounFactor = Math.min(0.5, properNouns / Math.max(1, content.length / 200) * 0.3)

  return Math.round((charFactor * 0.4 + paraFactor * 0.3 + nounFactor * 0.3) * 100) / 100
}

// ============================================================
// Emotional Engagement — 情绪投入
// ============================================================

const EMOTIONAL_WORDS = [
  // 高强度情绪
  '嘶吼', '咆哮', '痛哭', '狂笑', '颤抖', '崩溃',
  // 中等强度情绪
  '沉默', '叹息', '微笑', '皱眉', '握拳', '咬牙',
  // 弱强度情绪
  '瞥', '哼', '轻叹', '嘀咕',
]

function computeEmotionalEngagement(content: string): number {
  if (!content || content.length < 100) return 0.5

  // 情绪标记密度
  const hits = EMOTIONAL_WORDS.filter(w => content.includes(w)).length
  const density = hits / Math.max(1, content.length / 500)

  // 理想密度 2-6/500字
  const score = Math.min(1, Math.max(0, 1 - Math.abs(density - 4) / 4))

  return Math.round(score * 100) / 100
}

// ============================================================
// Narrative Trust — 读者对叙事的信任度
// ============================================================

function computeNarrativeTrust(
  _content: string,
  driftScore: number,
  fluidityScore: number,
): number {
  // 信任度 = 基于 drift 和 fluidity 的衰减
  // 高 drift → 读者怀疑前后矛盾 → 信任下降
  // 低 fluidity → 读者感觉机械 → 信任下降

  const driftPenalty = driftScore * 0.5
  const fluidityBonus = fluidityScore * 0.3
  const base = 0.7

  return Math.round(Math.max(0, Math.min(1, base - driftPenalty + fluidityBonus)) * 100) / 100
}

// ============================================================
// Attention Decay — 注意力衰减
// ============================================================

function computeAttentionDecay(content: string, chapterNumber: number): number {
  if (!content || content.length < 100) return 0.2

  // 检测段落长度趋势：后半部分段落如果比前半部分长 → 衰减
  const paragraphs = content.split(/\n+/).filter(p => p.trim().length > 0)
  if (paragraphs.length < 4) return 0.2

  const mid = Math.floor(paragraphs.length / 2)
  const firstHalf = paragraphs.slice(0, mid)
  const secondHalf = paragraphs.slice(mid)

  const firstAvg = firstHalf.reduce((s, p) => s + p.length, 0) / firstHalf.length
  const secondAvg = secondHalf.reduce((s, p) => s + p.length, 0) / secondHalf.length

  // 后半段明显变长 → 注意力衰减
  const lengthRatio = firstAvg > 0 ? secondAvg / firstAvg : 1
  const decayFromLength = Math.min(0.5, Math.max(0, (lengthRatio - 1) * 0.3))

  // 章节数本身也带来衰减（长篇疲劳）
  const fatigueFactor = Math.min(0.3, (chapterNumber - 10) / 100)

  return Math.round((decayFromLength + fatigueFactor) * 100) / 100
}

// ============================================================
// Momentum — 持续阅读驱动力
// ============================================================

function computeMomentum(curiosity: number, engagement: number, trust: number, decay: number): number {
  return Math.round(
    Math.max(0, Math.min(1,
      curiosity * 0.35 +
      engagement * 0.30 +
      trust * 0.20 -
      decay * 0.15
    )) * 100
  ) / 100
}

// ============================================================
// Payoff System
// ============================================================

export interface PayoffStatus {
  /** 悬而未决的谜题/伏笔数量 */
  openLoops: number
  /** 本章揭示的 payoff 数量 */
  payoffsThisChapter: number
  /** 最早未回收的伏笔距今章数 */
  oldestUnresolvedAge: number
  /** payoff 是否平衡（不至于过多谜题无解） */
  balanced: boolean
  /** 建议 */
  suggestion: string
}

export function analyzePayoffBalance(
  content: string,
  plotLines: PlotLine[],
  currentChapter: number,
): PayoffStatus {
  // 统计未结剧情线
  const openPlots = plotLines.filter(pl => pl.status === 'active' || pl.status === 'paused')

  // 统计本章的 payoff
  const payoffCount = CURIOSITY_PAYOFFS.filter(m => content.includes(m)).length

  // 最早未回收的伏笔
  const oldestAge = openPlots.length > 0
    ? currentChapter - Math.min(...openPlots.map(pl => pl.startedAt))
    : 0

  // 平衡判断：开放谜题 < 3 且 payoff 数 > 0 → 平衡
  const balanced = openPlots.length <= 3 && (payoffCount > 0 || openPlots.length === 0)

  let suggestion = ''
  if (openPlots.length > 5) {
    suggestion = `存在 ${openPlots.length} 个未结剧情线，建议近期回收部分伏笔`
  } else if (openPlots.length === 0 && currentChapter > 3) {
    suggestion = '当前无活跃剧情线，建议引入新的悬念或冲突'
  } else if (oldestAge > 15) {
    suggestion = `存在超过 ${oldestAge} 章未回收的早期伏笔，建议尽快处理`
  } else if (balanced) {
    suggestion = 'payoff 节奏良好'
  }

  return {
    openLoops: openPlots.length,
    payoffsThisChapter: payoffCount,
    oldestUnresolvedAge: oldestAge,
    balanced,
    suggestion,
  }
}

// ============================================================
// Reader Simulation (main entry)
// ============================================================

export interface ReaderSimResult {
  state: ReaderState
  payoff: PayoffStatus
  history: ReaderHistory | null
}

export async function simulateReaderReaction(
  content: string,
  chapterNumber: number,
  characterStates: CharacterStateSnapshot[],
  timeline: TimelineEvent[],
  driftScore: number,
  fluidityScore: number,
): Promise<ReaderSimResult> {
  const curiosity = computeCuriosity(content, timeline)
  const confusion = computeConfusion(content, characterStates)
  const emotionalEngagement = computeEmotionalEngagement(content)
  const narrativeTrust = computeNarrativeTrust(content, driftScore, fluidityScore)
  const attentionDecay = computeAttentionDecay(content, chapterNumber)
  const momentum = computeMomentum(curiosity, emotionalEngagement, narrativeTrust, attentionDecay)

  const state: ReaderState = {
    curiosity,
    confusion,
    emotionalEngagement,
    narrativeTrust,
    attentionDecay,
    momentum,
    chapterNumber,
    computedAt: new Date().toISOString(),
  }

  const plotLines = await canonStore.getPlotLines()
  const payoff = analyzePayoffBalance(content, plotLines, chapterNumber)

  // Load reader history
  let history: ReaderHistory | null = null
  try {
    const prevStates = await loadReaderHistory(chapterNumber - 1)
    if (prevStates.length > 0) {
      const allStates = [...prevStates, state]
      history = {
        states: allStates,
        trending: computeTrending(allStates),
      }
    }
  } catch {
    // ignore
  }

  // Persist reader state
  try {
    await canonStore.upsertSummary({
      chapterNumber: -chapterNumber, // negative to distinguish from regular summaries
      title: `reader_state_ch${chapterNumber}`,
      summary: JSON.stringify(state),
      createdAt: new Date().toISOString(),
    })
  } catch {
    // non-critical
  }

  return { state, payoff, history }
}

// ============================================================
// Reader History
// ============================================================

async function loadReaderHistory(upToChapter: number): Promise<ReaderState[]> {
  const states: ReaderState[] = []
  for (let ch = 1; ch <= upToChapter; ch++) {
    try {
      const summary = await canonStore.getSummary(-ch)
      if (summary?.summary) {
        states.push(JSON.parse(summary.summary) as ReaderState)
      }
    } catch {
      // skip chapters without reader state
    }
  }
  return states
}

function computeTrending(states: ReaderState[]): ReaderHistory['trending'] {
  if (states.length < 3) {
    return { curiosity: 'stable', engagement: 'stable', momentum: 'stable' }
  }

  const recent = states.slice(-5)

  function trend(values: number[]): 'rising' | 'stable' | 'falling' {
    if (values.length < 2) return 'stable'
    const first = values.slice(0, Math.floor(values.length / 2)).reduce((s, v) => s + v, 0) / Math.floor(values.length / 2)
    const second = values.slice(Math.floor(values.length / 2)).reduce((s, v) => s + v, 0) / (values.length - Math.floor(values.length / 2))
    if (second - first > 0.1) return 'rising'
    if (first - second > 0.1) return 'falling'
    return 'stable'
  }

  return {
    curiosity: trend(recent.map(s => s.curiosity)),
    engagement: trend(recent.map(s => s.emotionalEngagement)),
    momentum: trend(recent.map(s => s.momentum)),
  }
}

// ============================================================
// Adjustment — 将读者反馈转化为生成建议
// ============================================================

export function generateReaderAdjustment(
  state: ReaderState,
  payoff: PayoffStatus,
  history: ReaderHistory | null,
): string {
  const lines: string[] = [
    '【读者反馈 — 下一章生成调整建议】',
    '',
  ]

  // 好奇心
  if (state.curiosity < 0.4) {
    lines.push('- ⚠️ 读者好奇心不足，建议引入新的悬念、谜题或未解问题')
  } else if (state.curiosity > 0.8) {
    lines.push('- ✅ 读者好奇心强烈，可继续保持悬念节奏')
  }

  // 困惑度
  if (state.confusion > 0.5) {
    lines.push('- ⚠️ 读者理解成本偏高，建议简化情节或增加解释性段落')
  }

  // 情绪投入
  if (state.emotionalEngagement < 0.4) {
    lines.push('- ⚠️ 读者情绪投入偏低，建议增加角色内心独白或情感冲突')
  }

  // 信任度
  if (state.narrativeTrust < 0.5) {
    lines.push('- ⚠️ 读者对叙事信任度下降，建议修补前后矛盾，增强一致性')
  }

  // 注意力衰减
  if (state.attentionDecay > 0.5) {
    lines.push('- ⚠️ 读者注意力衰减加速，建议缩短段落或增加节奏变化')
  }

  // Momentum
  if (state.momentum < 0.5) {
    lines.push('- ⚠️ 读者持续阅读驱动力不足，建议引入 cliffhanger 或紧迫事件')
  } else {
    lines.push('- ✅ 读者阅读驱动力良好，可保持当前节奏')
  }

  // Payoff
  if (!payoff.balanced) {
    lines.push(`- ${payoff.suggestion}`)
  }

  // Trending
  if (history?.trending) {
    lines.push('')
    lines.push('## 趋势')
    const arrows: Record<string, string> = { rising: '📈', stable: '➡️', falling: '📉' }
    lines.push(`- 好奇心：${arrows[history.trending.curiosity]} ${history.trending.curiosity}`)
    lines.push(`- 情绪投入：${arrows[history.trending.engagement]} ${history.trending.engagement}`)
    lines.push(`- 阅读驱动力：${arrows[history.trending.momentum]} ${history.trending.momentum}`)
  }

  return lines.join('\n')
}

// ============================================================
// Prompt injection helpers
// ============================================================

export function renderReaderState(state: ReaderState): string {
  return [
    `【读者状态模型 — 第${state.chapterNumber}章】`,
    `  好奇心 (curiosity):          ${renderBar(state.curiosity)} ${state.curiosity.toFixed(2)}`,
    `  理解成本 (confusion):         ${renderBar(1 - state.confusion)} ${state.confusion.toFixed(2)}`,
    `  情绪投入 (engagement):       ${renderBar(state.emotionalEngagement)} ${state.emotionalEngagement.toFixed(2)}`,
    `  叙事信任 (trust):            ${renderBar(state.narrativeTrust)} ${state.narrativeTrust.toFixed(2)}`,
    `  注意力衰减 (decay):          ${renderBar(1 - state.attentionDecay)} ${state.attentionDecay.toFixed(2)}`,
    `  阅读驱动力 (momentum):        ${renderBar(state.momentum)} ${state.momentum.toFixed(2)}`,
  ].join('\n')
}

export function renderCuriosityState(payoff: PayoffStatus): string {
  return [
    '【好奇心曲线状态】',
    `  未解谜题: ${payoff.openLoops} 个`,
    `  本章揭示: ${payoff.payoffsThisChapter} 个`,
    `  最早未回收: ${payoff.oldestUnresolvedAge} 章前`,
    `  payoff 平衡: ${payoff.balanced ? '✅ 是' : '⚠️ 否'}`,
    `  ${payoff.suggestion}`,
  ].join('\n')
}

function renderBar(value: number): string {
  const filled = Math.round(value * 10)
  return '█'.repeat(filled) + '░'.repeat(10 - filled)
}
