/**
 * Semantic Coherence Engine (v4) — 语义叙事层
 *
 * 在 v3 的 drift-free state machine 之上新增语义一致性：
 *   - 角色行为必须由意图驱动（CharacterIntentModel）
 *   - 情绪跨章节连续不可 reset（EmotionalTrajectory）
 *   - 事件必须形成因果链（CausalGraph）
 *   - 自动检测语义断裂并修复（NarrativeCoherenceEngine）
 */
import type {
  CharacterStateSnapshot,
  TimelineEvent,
  ConsistencyIssue,
} from './types'

// ============================================================
// v4 扩展类型（追加到 CharacterStateSnapshot 可选字段中）
// ============================================================

export interface CharacterIntent {
  /** 本章短期意图 */
  shortTermIntent: string
  /** 长期目标 */
  longTermGoal: string
  /** 隐藏动机（读者未知但角色已知） */
  hiddenMotivation: string
  /** 冲突驱动因素 */
  conflictDrivers: string[]
}

export interface EmotionalState {
  /** 当前情绪标签（愤怒/悲伤/喜悦/恐惧/平静...） */
  emotion: string
  /** 强度 0~1 */
  intensity: number
  /** 触发事件描述 */
  causeEvent: string
  /** 首次出现章节 */
  firstSeenChapter: number
  /** 最新出现章节 */
  lastSeenChapter: number
}

export interface CausalLink {
  /** 原因事件 ID（在 timeline 中的 id） */
  causeEventId: number
  /** 结果事件 ID */
  effectEventId: number
  /** 因果类型 */
  relationship: 'direct' | 'indirect' | 'triggered'
}

// ============================================================
// Intention Consistency Check
// ============================================================

/**
 * 检查章节中角色的行为是否与其意图一致。
 * 启发式：在章节内容中搜索角色的动作，与角色 currentGoal/shortTermIntent 对比。
 */
export function checkIntentionConsistency(
  content: string,
  characterStates: CharacterStateSnapshot[],
): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = []

  for (const cs of characterStates) {
    const goal = cs.currentGoal?.trim()
    if (!goal || goal.length < 2) continue

    // 检查章节中是否出现了角色
    if (!content.includes(cs.character)) continue

    // 启发式：角色的目标是否在章节中被推进？
    // 简单检测：章节末尾附近是否有与目标相关的文本
    const lastHalf = content.slice(-Math.floor(content.length / 2))
    const goalKeywords = extractKeywords(goal, 3)
    const goalMentions = goalKeywords.filter(k => lastHalf.includes(k))

    if (goalMentions.length === 0 && goalKeywords.length > 0) {
      issues.push({
        severity: 'warning',
        category: 'continuity',
        characters: [cs.character],
        message: `角色「${cs.character}」的当前目标「${goal}」在本章后半部分未出现相关推进，可能存在意图悬挂`,
        chapterNumber: cs.updatedAtChapter,
      })
    }
  }

  return issues
}

// ============================================================
// Emotional Continuity Check
// ============================================================

const EMOTION_LEXICON: Record<string, string[]> = {
  '愤怒': ['怒', '生气', '愤', '吼', '咆哮', '暴', '火'],
  '悲伤': ['哭', '泪', '悲', '哀', '痛', '伤', '沉默', '低'],
  '喜悦': ['笑', '喜', '乐', '欢', '高兴', '兴奋', '激动'],
  '恐惧': ['怕', '恐', '颤抖', '惊', '慌', '逃', '躲'],
  '平静': ['平静', '淡', '冷', '安静', '静静', '叹'],
  '焦虑': ['急', '焦', '不安', '踱', '咬', '捏', '攥'],
}

function detectPredominantEmotion(paragraph: string): { emotion: string; intensity: number } | null {
  let bestEmotion = ''
  let bestScore = 0

  for (const [emotion, keywords] of Object.entries(EMOTION_LEXICON)) {
    let score = 0
    for (const kw of keywords) {
      const re = new RegExp(kw, 'g')
      const matches = paragraph.match(re)
      if (matches) score += matches.length
    }
    if (score > bestScore) {
      bestScore = score
      bestEmotion = emotion
    }
  }

  if (bestScore === 0) return null
  return { emotion: bestEmotion, intensity: Math.min(1, bestScore / 5) }
}

/**
 * 检查章节的情绪是否与上一章保持连续性。
 * 策略：比较当前章开头与前章结尾的情绪基调，检测突变。
 */
export function checkEmotionalContinuity(
  content: string,
  previousEnding: string,
): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = []

  if (!previousEnding || previousEnding.length < 30) return issues
  if (content.length < 30) return issues

  // 取前章结尾最后一段和本章开头第一段
  const prevPara = previousEnding.slice(-200)
  const currPara = content.slice(0, 200)

  const prevEmotion = detectPredominantEmotion(prevPara)
  const currEmotion = detectPredominantEmotion(currPara)

  if (!prevEmotion || !currEmotion) return issues

  // 情绪从高烈度突然跳到平静（无过渡） → 警告
  if (prevEmotion.intensity > 0.6 && currEmotion.intensity < 0.2) {
    // 除非中间有明确的转场标记
    const transition = content.slice(0, 500)
    const hasTransition = /过了一会儿|次日|凌晨|早上|翌日|数日后|一段时间后/.test(transition)
    if (!hasTransition) {
      issues.push({
        severity: 'warning',
        category: 'continuity',
        message: `情绪从「${prevEmotion.emotion}」（强度 ${prevEmotion.intensity}）突变为「${currEmotion.emotion}」（强度 ${currEmotion.intensity}），中间无转场标记`,
        evidence: `prev: ${prevEmotion.emotion}/${prevEmotion.intensity} → curr: ${currEmotion.emotion}/${currEmotion.intensity}`,
      })
    }
  }

  return issues
}

// ============================================================
// Causal Validity Check
// ============================================================

/**
 * 检查章节中事件的因果完整性。
 * 策略：事件不能凭空出现，必须有前序事件铺垫。
 */
export function checkCausalValidity(
  content: string,
  timeline: TimelineEvent[],
  currentChapter: number,
): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = []

  // 检查本章是否有孤立事件（无前序因果）
  const chapterEvents = timeline.filter(e => e.chapterNumber === currentChapter)
  const priorEvents = timeline.filter(e => e.chapterNumber < currentChapter)

  for (const ev of chapterEvents) {
    // 启发式：事件中涉及的角色在前序 timeline 中是否出现过
    for (const ch of ev.characters) {
      const priorAppearance = priorEvents.some(e => e.characters.includes(ch))
      if (!priorAppearance && priorEvents.length > 0 && currentChapter > 1) {
        issues.push({
          severity: 'info',
          category: 'continuity',
          characters: [ch],
          message: `第${currentChapter}章事件「${ev.summary.slice(0, 30)}」涉及角色「${ch}」，但该角色在之前时间线中无任何记录`,
          chapterNumber: currentChapter,
          evidence: ev.summary.slice(0, 60),
        })
      }
    }
  }

  // 检查本章是否有"因此"、"于是"等因果词指向不存在的前序事件
  const causalMarkers = /因此|于是|所以|正因如此|因为.*所以/.source
  const paragraphs = content.split(/\n+/).filter(p => p.trim().length > 20)
  for (const p of paragraphs) {
    if (!new RegExp(causalMarkers).test(p)) continue
    // 章节开头出现因果词但没有前序 → 可疑
    const idx = paragraphs.indexOf(p)
    if (idx === 0 && currentChapter > 1) {
      issues.push({
        severity: 'warning',
        category: 'continuity',
        message: `本章开头使用了因果连接词，但无前序事件铺垫，可能存在因果断裂`,
        evidence: p.slice(0, 80),
      })
    }
  }

  return issues
}

// ============================================================
// 聚合语义一致性校验
// ============================================================

export interface SemanticCheckParams {
  chapterNumber: number
  chapterContent: string
  characterStates: CharacterStateSnapshot[]
  previousEnding: string
  timeline: TimelineEvent[]
  isRewrite?: boolean
}

export function checkSemanticCoherence(params: SemanticCheckParams): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = []

  issues.push(...checkIntentionConsistency(params.chapterContent, params.characterStates))
  issues.push(...checkEmotionalContinuity(params.chapterContent, params.previousEnding))
  issues.push(...checkCausalValidity(params.chapterContent, params.timeline, params.chapterNumber))

  return issues
}

// ============================================================
// Prompt Compiler 增强
// ============================================================

/**
 * 从角色状态中提取意图注入文本
 */
export function renderCharacterIntentions(states: CharacterStateSnapshot[]): string {
  if (states.length === 0) return '（暂无角色意图记录）'
  return states
    .filter(s => s.currentGoal?.trim())
    .map(s => {
      const goal = s.currentGoal ? `短期目标：${s.currentGoal}` : ''
      const mental = s.mentalState ? `心理状态：${s.mentalState}` : ''
      return `- ${s.character} | ${goal} | ${mental}`.replace(/ \| $/, '')
    })
    .filter(s => s.length > 3)
    .join('\n') || '（暂无角色意图记录）'
}

/**
 * 从 timeline 中构建因果链图注入文本
 */
export function renderCausalGraph(timeline: TimelineEvent[], maxEvents = 20): string {
  if (timeline.length === 0) return '（暂无时间线事件记录）'

  const recent = timeline.slice(-maxEvents)
  return recent
    .map(e => {
      const flashbackTag = e.timeFlow === 'flashback' ? ' [闪回]' : ''
      const chars = e.characters?.length ? ` [${e.characters.join(', ')}]` : ''
      return `[Ch${e.chapterNumber}.#${e.sequence}${flashbackTag}]${chars} ${e.location ? `@${e.location} ` : ''}${e.summary}${e.impact ? ` → ${e.impact}` : ''}`
    })
    .join('\n')
}

/**
 * 从角色 mentalState 推断情绪轨迹
 */
export function renderEmotionalTrajectory(states: CharacterStateSnapshot[]): string {
  if (states.length === 0) return '（暂无情绪轨迹记录）'

  return states
    .filter(s => s.mentalState?.trim() || s.physicalState?.trim())
    .map(s => {
      const mental = s.mentalState?.trim()
      const physical = s.physicalState?.trim()
      const parts: string[] = []
      if (mental) parts.push(`情绪：${mental}`)
      if (physical) parts.push(`身体：${physical}`)
      return `- ${s.character}（第${s.updatedAtChapter}章）${parts.join(' | ')}`
    })
    .join('\n') || '（暂无情绪轨迹记录）'
}

// ============================================================
// 语义修复上下文
// ============================================================

export function generateSemanticFixContext(issues: ConsistencyIssue[]): string {
  if (issues.length === 0) return ''

  const lines: string[] = [
    '【语义一致性修复指引】',
    '以下是在语义层检测到的问题：',
    '',
  ]

  for (const issue of issues) {
    const sev = issue.severity === 'error' ? '🔴' : issue.severity === 'warning' ? '🟡' : '🟢'
    lines.push(`${sev} ${issue.message}`)
    if (issue.evidence) lines.push(`   证据：${issue.evidence}`)
  }

  lines.push('')
  lines.push('修复原则：')
  lines.push('1. 角色行为必须有明确的意图驱动，不能凭空行动')
  lines.push('2. 情绪变化必须有事件触发，不能突然 reset 或突变')
  lines.push('3. 每个事件必须有前序因果来源（除非是首章开篇事件）')
  lines.push('4. 意图/情绪/因果的修复不能引入新的状态矛盾')

  return lines.join('\n')
}

// ============================================================
// 辅助
// ============================================================

function extractKeywords(text: string, count: number): string[] {
  const words = text
    .replace(/[，。！？、；：""''（）【】《》\s]/g, ' ')
    .split(' ')
    .filter(w => w.length >= 2)
  // 取最长的 N 个关键词
  return words
    .sort((a, b) => b.length - a.length)
    .slice(0, count)
}
