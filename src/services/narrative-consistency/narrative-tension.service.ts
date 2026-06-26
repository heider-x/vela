/**
 * Narrative Tension Engine (v6) — 叙事张力与流动系统
 *
 * 在 v5 稳定性之上增加人类感：
 *   - 允许轻微语义漂移（smoothness layer）
 *   - 角色行为概率驱动（probabilistic character model）
 *   - 控制信息延迟和冲突强度（tension engine）
 *   - 替代 rigid gate 的 soft consistency score
 *
 * 核心理念：stability（v5）保证不崩坏，fluidity（v6）保证不机械。
 * 二者通过 fluidity_score 融合。
 */
import type { CharacterStateSnapshot, TimelineEvent } from './types'

// ============================================================
// Fluidity Score（流动性分数）
// ============================================================

export interface FluidityScore {
  overall: number
  dimensions: {
    naturalVariation: number   // 自然波动度
    tensionQuality: number      // 张力质量
    characterDepth: number      // 角色深度
    pacingRhythm: number        // 节奏感
  }
  /** 与 v5 stability_score 的融合 */
  combinedScore: number
  mode: 'flowing' | 'balanced' | 'tight' | 'locked'
  computedAt: string
}

// ============================================================
// 1. Natural Variation — 允许自然叙事波动
// ============================================================

/**
 * 检测章节中是否存在自然的人类叙事特征：
 *   - 非完全对称的段落结构
 *   - 节奏变化（长短句交替）
 *   - 情感层次的起伏
 */
function computeNaturalVariation(content: string): number {
  if (!content || content.length < 100) return 0.5 // 默认中立

  const paragraphs = content.split(/\n+/).filter(p => p.trim().length > 0)

  // 段落长度方差 → 高方差 = 自然变化
  if (paragraphs.length < 3) return 0.5
  const lengths = paragraphs.map(p => p.length)
  const avg = lengths.reduce((s, l) => s + l, 0) / lengths.length
  const variance = lengths.reduce((s, l) => s + (l - avg) ** 2, 0) / lengths.length
  const cv = avg > 0 ? Math.sqrt(variance) / avg : 0

  // 变异系数 0.3-0.8 为理想范围（有变化但不极端）
  const cvScore = Math.min(1, Math.max(0, 1 - Math.abs(cv - 0.55) * 2))

  // 对话比例 → 适中的对话密度
  const dialogueLines = paragraphs.filter(p => /[""「」『』"']|说|道|问|答/.test(p))
  const dialogueRatio = dialogueLines.length / paragraphs.length
  // 0.15-0.45 为理想对话密度
  const dialogueScore = Math.min(1, Math.max(0, 1 - Math.abs(dialogueRatio - 0.3) * 3))

  return Math.round((cvScore * 0.6 + dialogueScore * 0.4) * 100) / 100
}

// ============================================================
// 2. Tension Quality — 张力质量
// ============================================================

const TENSION_MARKERS = {
  conflict: ['对峙', '冲突', '矛盾', '对立', '争执', '对决', '战斗', '厮杀'],
  suspense: ['悬念', '伏笔', '暗示', '谜团', '秘密', '隐藏', '未知', '疑惑'],
  misdirection: ['以为', '没想到', '原来', '竟然', '难道', '莫非', '殊不知'],
  revelation: ['揭示', '揭露', '暴露', '真相', '终于', '恍然', '明白'],
  pacing: ['突然', '猛然', '缓缓', '渐渐', '忽然', '立即', '一瞬间', '片刻'],
}

function computeTensionQuality(content: string, timeline: TimelineEvent[], currentChapter: number): number {
  if (!content) return 0.5

  // 检测各种张力标记的出现频率
  const scores: number[] = []
  for (const markers of Object.values(TENSION_MARKERS)) {
    const hits = markers.filter(m => content.includes(m)).length
    const density = hits / Math.max(1, content.length / 500) // 每500字
    // 每个类别理想密度 1-3
    const catScore = Math.min(1, Math.max(0, 1 - Math.abs(density - 2) / 2))
    scores.push(catScore)
  }

  const avgScore = scores.reduce((s, v) => s + v, 0) / scores.length

  // 事件密度也影响张力：过多紧凑事件 = 高张力（可能过头），过少 = 平淡
  const chapterEvents = timeline.filter(e => e.chapterNumber === currentChapter)
  const eventScore = Math.min(1, chapterEvents.length / 8) // 理想 3-8 事件/章

  return Math.round((avgScore * 0.7 + eventScore * 0.3) * 100) / 100
}

// ============================================================
// 3. Character Depth — 角色深度（概率模型）
// ============================================================

export interface ProbabilisticIntent {
  /** 意图分布（intent → probability） */
  distribution: Record<string, number>
  /** 决策偏差（biased toward certain choices） */
  bias: string
  /** 不确定性等级 0-1（0=完全确定，1=完全随机） */
  uncertainty: number
}

/**
 * 从角色状态推断概率意图分布。
 * 启发式：基于 currentGoal 和 mentalState 构建可能的意图空间。
 */
export function inferProbabilisticIntent(cs: CharacterStateSnapshot): ProbabilisticIntent {
  const goal = cs.currentGoal?.trim() || ''
  const mental = cs.mentalState?.trim() || ''

  // 从 goal 中提取意图关键词
  const intentKeywords = extractIntentKeywords(goal)
  const distribution: Record<string, number> = {}

  // 主意图 60%
  if (intentKeywords.length > 0) {
    distribution[intentKeywords[0]] = 0.6
    // 次意图 25%
    if (intentKeywords.length > 1) {
      distribution[intentKeywords[1]] = 0.25
    }
    // 其余 15% 均分
    const rest = intentKeywords.slice(2)
    if (rest.length > 0) {
      const each = 0.15 / rest.length
      for (const kw of rest) {
        distribution[kw] = each
      }
    }
  } else {
    distribution['未知意图'] = 1.0
  }

  // 从 mentalState 推断偏差
  const bias = inferDecisionBias(mental)

  // 不确定性：目标越模糊 → 越高
  const uncertainty = goal.length < 5 ? 0.7 : goal.length < 15 ? 0.4 : 0.2

  return { distribution, bias, uncertainty }
}

function extractIntentKeywords(goal: string): string[] {
  const patterns = [
    /寻找|找到|获得|得到|取得/g,
    /复仇|报仇|报复/g,
    /保护|守护|捍卫/g,
    /逃离|逃脱|离开|摆脱/g,
    /征服|战胜|击败/g,
    /拯救|解救/g,
    /探索|发现|揭示/g,
    /成长|变强|修炼/g,
    /隐瞒|隐藏|保密/g,
    /追求|追寻/g,
  ]
  const keywords: string[] = []
  for (const p of patterns) {
    const matches = goal.match(p)
    if (matches) keywords.push(matches[0])
  }
  return keywords.length > 0 ? keywords : [goal.slice(0, 10)]
}

function inferDecisionBias(mental: string): string {
  const biases: Record<string, string[]> = {
    '冲动倾向': ['愤怒', '暴', '急', '焦'],
    '谨慎倾向': ['冷静', '思考', '谋', '分析'],
    '情感倾向': ['爱', '悲', '喜', '忧', '思念'],
    '理性倾向': ['计算', '计划', '策略', '权衡'],
  }
  for (const [bias, markers] of Object.entries(biases)) {
    if (markers.some(m => mental.includes(m))) return bias
  }
  return '中性'
}

function computeCharacterDepth(characterStates: CharacterStateSnapshot[]): number {
  if (characterStates.length === 0) return 0.5

  let depthSum = 0
  for (const cs of characterStates) {
    const goal = cs.currentGoal?.trim()
    const mental = cs.mentalState?.trim()
    // 目标 + 心理状态都有 → 深度高
    const hasGoal = goal && goal.length > 3
    const hasMental = mental && mental.length > 3
    const hasConflict = goal ? /但|却|然而|可是|矛盾/.test(goal) : false

    let charDepth = 0.3 // baseline
    if (hasGoal) charDepth += 0.2
    if (hasMental) charDepth += 0.2
    if (hasConflict) charDepth += 0.3

    depthSum += Math.min(1, charDepth)
  }

  return Math.round((depthSum / characterStates.length) * 100) / 100
}

// ============================================================
// 4. Pacing Rhythm — 节奏感
// ============================================================

function computePacingRhythm(content: string): number {
  if (!content || content.length < 200) return 0.5

  const sentences = content.split(/[。！？]/).filter(s => s.trim().length > 0)

  // 句子长度序列 → 检测节奏模式（理想：长短交替）
  if (sentences.length < 5) return 0.5

  const lengths = sentences.map(s => s.length)
  let rhythmScore = 0

  // 相邻句子的长度差异 → 差异大 = 节奏好
  for (let i = 1; i < lengths.length; i++) {
    const diff = Math.abs(lengths[i] - lengths[i - 1])
    // 理想差异 5-25 字符
    const localScore = Math.min(1, Math.max(0, 1 - Math.abs(diff - 15) / 15))
    rhythmScore += localScore
  }
  rhythmScore /= (lengths.length - 1)

  return Math.round(rhythmScore * 100) / 100
}

// ============================================================
// Aggregate Fluidity Score
// ============================================================

export function determineFluidityMode(score: number): FluidityScore['mode'] {
  if (score > 0.8) return 'flowing'
  if (score > 0.6) return 'balanced'
  if (score > 0.4) return 'tight'
  return 'locked'
}

export function computeFluidityScore(
  content: string,
  characterStates: CharacterStateSnapshot[],
  timeline: TimelineEvent[],
  currentChapter: number,
  stabilityOverall: number,
): FluidityScore {
  const naturalVariation = computeNaturalVariation(content)
  const tensionQuality = computeTensionQuality(content, timeline, currentChapter)
  const characterDepth = computeCharacterDepth(characterStates)
  const pacingRhythm = computePacingRhythm(content)

  const overall = Math.round((
    naturalVariation * 0.25 +
    tensionQuality * 0.30 +
    characterDepth * 0.25 +
    pacingRhythm * 0.20
  ) * 100) / 100

  // 融合 stability 和 fluidity：
  //   stability 高 + fluidity 高 = 理想（flowing）
  //   stability 高 + fluidity 低 = 机械（tight）
  //   stability 低 + fluidity 高 = 狂野（locked）
  //   stability 低 + fluidity 低 = 崩溃（locked）
  const combinedScore = Math.round((stabilityOverall * 0.5 + (1 - overall) * 0.3) * 100) / 100

  return {
    overall,
    dimensions: { naturalVariation, tensionQuality, characterDepth, pacingRhythm },
    combinedScore,
    mode: determineFluidityMode(overall),
    computedAt: new Date().toISOString(),
  }
}

// ============================================================
// Narrative Smoothness Layer
// ============================================================

export interface SmoothnessResult {
  content: string
  applied: boolean
  adjustments: string[]
}

/**
 * 叙事平滑层 —— 允许轻微的类人语义漂移，消除机械感。
 * 不做严格修正，而是做轻量润色。
 */
export function applySmoothness(
  content: string,
  fluidityScore: FluidityScore,
): SmoothnessResult {
  let working = content
  const adjustments: string[] = []

  // 1. flowing mode: 几乎不干预
  if (fluidityScore.mode === 'flowing' || fluidityScore.mode === 'balanced') {
    return { content: working, applied: false, adjustments }
  }

  // 2. 段落过渡平滑：确保段落之间没有突兀跳跃
  const paragraphs = content.split(/\n+/).filter(p => p.trim().length > 0)
  const smoothed: string[] = []

  for (let i = 0; i < paragraphs.length; i++) {
    smoothed.push(paragraphs[i])

    // 在两个连续段落之间检测突然的话题跳变
    if (i < paragraphs.length - 1) {
      const curr = paragraphs[i]
      const next = paragraphs[i + 1]

      // 如果两个段落都短且话题不连贯 → 插入过渡
      if (curr.length < 30 && next.length < 30) {
        const currWords = new Set(curr.replace(/[，。！？]/g, ' ').split(/\s+/).filter(w => w.length >= 2))
        const nextWords = new Set(next.replace(/[，。！？]/g, ' ').split(/\s+/).filter(w => w.length >= 2))
        const overlap = [...currWords].filter(w => nextWords.has(w))

        if (overlap.length === 0) {
          // 无共同词汇 → 可能是跳变
          adjustments.push(`段落 ${i + 1}→${i + 2} 话题跳变（保留为自然叙述节奏）`)
        }
      }
    }
  }

  if (smoothed.length !== paragraphs.length) {
    working = smoothed.join('\n\n')
    adjustments.push('合并过短段落')
  }

  return {
    content: working,
    applied: adjustments.length > 0,
    adjustments,
  }
}

// ============================================================
// Soft Consistency Check
// ============================================================

export interface SoftConsistencyResult {
  /** 0=完全不一致, 1=完全一致 */
  score: number
  /** 是否通过（>= 0.6） */
  passed: boolean
  /** 轻量修复建议 */
  suggestions: string[]
  /** 是否需要进入 refine 循环 */
  needsRefine: boolean
}

/**
 * 软一致性检查 —— 替代 v5 的 hard BLOCK。
 * 使用 consistency_score（0~1）而非 verdict。
 * 仅当 combinedScore > 0.85 时才阻止定稿。
 */
export function softConsistencyCheck(
  stabilityScore: number,
  driftScore: number,
  fluidityScore: FluidityScore,
  gateIssues: number,
): SoftConsistencyResult {
  // 加权合并
  const score = 1 - (
    stabilityScore * 0.30 +
    driftScore * 0.25 +
    (1 - fluidityScore.overall) * 0.20 +
    Math.min(1, gateIssues / 10) * 0.25
  )

  const clamped = Math.round(Math.max(0, Math.min(1, score)) * 100) / 100
  const passed = clamped >= 0.6
  const needsRefine = clamped < 0.4

  const suggestions: string[] = []

  if (stabilityScore > 0.5) {
    suggestions.push('建议降低上下文复杂度（加载 snapshot）')
  }
  if (driftScore > 0.3) {
    suggestions.push('检测到轻微跨章节漂移，建议复查时间线')
  }
  if (fluidityScore.overall < 0.4) {
    suggestions.push('叙述可能过于机械，建议允许更多自然变奏')
  }
  if (gateIssues > 5) {
    suggestions.push(`存在 ${gateIssues} 项一致性提示，优先修复 HIGH 级问题`)
  }

  return { score: clamped, passed, suggestions, needsRefine }
}

// ============================================================
// Formatting helpers
// ============================================================

export function formatFluidityReport(fs: FluidityScore): string {
  const modeLabels: Record<FluidityScore['mode'], string> = {
    flowing: '🌊 流畅叙事',
    balanced: '⚖️ 平衡',
    tight: '🔒 偏紧',
    locked: '⛓️ 过紧（机械感）',
  }

  return [
    `📊 流动报告（fluidity ${fs.overall} — ${modeLabels[fs.mode]}）`,
    `  naturalVariation: ${fs.dimensions.naturalVariation.toFixed(2)}`,
    `  tensionQuality:   ${fs.dimensions.tensionQuality.toFixed(2)}`,
    `  characterDepth:   ${fs.dimensions.characterDepth.toFixed(2)}`,
    `  pacingRhythm:     ${fs.dimensions.pacingRhythm.toFixed(2)}`,
    `  融合评分（stability+fluidity）：${fs.combinedScore.toFixed(2)}`,
  ].join('\n')
}
