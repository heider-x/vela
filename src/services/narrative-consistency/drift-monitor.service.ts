/**
 * Canon Drift Monitor (v3) — 跨章节漂移检测器
 *
 * 定期扫描历史章节（window=5~10），检测累积性不一致：
 *   - 人物状态漂移（location/emotion/knowledge）
 *   - 时间线压缩错误
 *   - 关系逐步退化或跳变
 *   - 伏笔未闭环
 *   - 事实不一致累积
 *
 * 输出 drift score（0~1）供 ConsistencyGate 决策。
 */
import type {
  TimelineEvent,
  CharacterStateSnapshot,
  PlotLine,
} from './types'
import { canonStore } from './canon-store'

// ============================================================
// Drift 类型
// ============================================================

export type DriftType =
  | 'CHARACTER_LOCATION_DRIFT'
  | 'CHARACTER_EMOTION_DRIFT'
  | 'KNOWLEDGE_DRIFT'
  | 'TIMELINE_COMPRESSION'
  | 'RELATIONSHIP_DEGRADATION'
  | 'PLOT_THREAD_ABANDONMENT'
  | 'FACT_INCONSISTENCY_ACCUMULATION'

export interface DriftEntry {
  type: DriftType
  severity: 'LOW' | 'MEDIUM' | 'HIGH'
  description: string
  affectedEntities: string[]
  firstSeenAt: number
  lastSeenAt: number
  detectionEvidence: string
}

export interface DriftReport {
  driftScore: number
  entries: DriftEntry[]
  scannedChapterRange: [number, number]
  generatedAt: string
}

// ============================================================
// 逐漂移类型检测
// ============================================================

interface Trajectory {
  chapterNumber: number
  value: string
}

/** 为每个角色建立地点轨迹 */
function buildLocationTrajectories(
  timeline: TimelineEvent[],
  characters: string[],
): Map<string, Trajectory[]> {
  const map = new Map<string, Trajectory[]>()
  for (const ch of characters) {
    map.set(ch, [])
  }
  for (const ev of timeline.sort((a, b) => a.chapterNumber - b.chapterNumber || a.sequence - b.sequence)) {
    for (const ch of ev.characters) {
      if (map.has(ch) && ev.location) {
        map.get(ch)!.push({ chapterNumber: ev.chapterNumber, value: ev.location })
      }
    }
  }
  return map
}

function detectLocationDrift(
  timeline: TimelineEvent[],
  characterStates: CharacterStateSnapshot[],
  startChapter: number,
  endChapter: number,
): DriftEntry[] {
  const entries: DriftEntry[] = []
  const chars = characterStates.filter(s => s.location?.trim())
  const trajectories = buildLocationTrajectories(timeline, chars.map(c => c.character))

  for (const [ch, traj] of trajectories) {
    const inWindow = traj.filter(t => t.chapterNumber >= startChapter && t.chapterNumber <= endChapter)
    if (inWindow.length < 2) continue
    // 检测反向移动：回到之前的地点
    for (let i = 1; i < inWindow.length; i++) {
      // 看 3+ 步之前是否有相同地点（非回归性回到原地）
      const lookback = Math.max(0, i - 3)
      for (let j = lookback; j < i; j++) {
        if (inWindow[j].value === inWindow[i].value && inWindow[i].chapterNumber - inWindow[j].chapterNumber > 1) {
          entries.push({
            type: 'CHARACTER_LOCATION_DRIFT',
            severity: 'MEDIUM',
            description: `角色「${ch}」在第${inWindow[j].chapterNumber}章和第${inWindow[i].chapterNumber}章重复处于「${inWindow[j].value}」，中间无行程说明`,
            affectedEntities: [ch],
            firstSeenAt: inWindow[j].chapterNumber,
            lastSeenAt: inWindow[i].chapterNumber,
            detectionEvidence: `${ch} at ${inWindow[j].value} (ch${inWindow[j].chapterNumber}) → ... → ${ch} at ${inWindow[i].value} (ch${inWindow[i].chapterNumber})`,
          })
        }
      }
    }
  }
  return entries
}

function detectKnowledgeDrift(
  timeline: TimelineEvent[],
  characterStates: CharacterStateSnapshot[],
  startChapter: number,
  endChapter: number,
): DriftEntry[] {
  const entries: DriftEntry[] = []
  for (const cs of characterStates) {
    const knowledge = cs.knowledge || []
    if (!knowledge.length) continue
    // 检查每项 knowledge 是否有 event 来源
    for (const k of knowledge) {
      const hasEvent = timeline.some(ev =>
        ev.chapterNumber >= startChapter &&
        ev.chapterNumber <= endChapter &&
        ev.characters.includes(cs.character) &&
        ev.summary.includes(k.slice(0, 10)),
      )
      if (!hasEvent && cs.updatedAtChapter >= startChapter) {
        entries.push({
          type: 'KNOWLEDGE_DRIFT',
          severity: 'HIGH',
          description: `角色「${cs.character}」拥有 knowledge「${k.slice(0, 30)}」但在时间线中未找到对应事件来源`,
          affectedEntities: [cs.character],
          firstSeenAt: cs.updatedAtChapter,
          lastSeenAt: endChapter,
          detectionEvidence: `knowledge: ${k.slice(0, 40)} @ ch${cs.updatedAtChapter}`,
        })
      }
    }
  }
  return entries
}

function detectTimelineCompression(
  timeline: TimelineEvent[],
  startChapter: number,
  endChapter: number,
): DriftEntry[] {
  const entries: DriftEntry[] = []
  const inWindow = timeline.filter(e => e.chapterNumber >= startChapter && e.chapterNumber <= endChapter)
  if (inWindow.length < 3) return entries

  // 检测章节密度异常：某章事件远多/远少于平均
  const densityMap = new Map<number, number>()
  for (const e of inWindow) {
    densityMap.set(e.chapterNumber, (densityMap.get(e.chapterNumber) || 0) + 1)
  }
  const densities = Array.from(densityMap.values())
  const avg = densities.reduce((s, v) => s + v, 0) / densities.length
  for (const [ch, d] of densityMap) {
    if (avg > 0 && (d > avg * 3 || d < avg * 0.2)) {
      entries.push({
        type: 'TIMELINE_COMPRESSION',
        severity: 'LOW',
        description: `第${ch}章事件密度异常（${d} 条 vs 平均 ${avg.toFixed(1)}），可能是时间线压缩或膨胀`,
        affectedEntities: [],
        firstSeenAt: ch,
        lastSeenAt: ch,
        detectionEvidence: `density ${d} vs avg ${avg.toFixed(1)}`,
      })
    }
  }
  return entries
}

function detectPlotThreadAbandonment(
  plotLines: PlotLine[],
  endChapter: number,
): DriftEntry[] {
  const entries: DriftEntry[] = []
  const THRESHOLD = 10 // 10章未推进视为 abandon
  for (const pl of plotLines) {
    if (pl.status !== 'active') continue
    const idle = endChapter - pl.lastAdvancedAt
    if (idle > THRESHOLD) {
      entries.push({
        type: 'PLOT_THREAD_ABANDONMENT',
        severity: 'MEDIUM',
        description: `剧情线「${pl.name}」已 ${idle} 章未推进（最近推进第${pl.lastAdvancedAt}章）`,
        affectedEntities: pl.characters,
        firstSeenAt: pl.lastAdvancedAt,
        lastSeenAt: endChapter,
        detectionEvidence: `started ch${pl.startedAt}, last @ ch${pl.lastAdvancedAt}`,
      })
    }
  }
  return entries
}

function detectRelationshipDegradation(
  characterStates: CharacterStateSnapshot[],
): DriftEntry[] {
  const entries: DriftEntry[] = []
  // 启发式：关系字段出现矛盾描述（敌→友→敌 无明显事件）
  // 在无事件数据的情况下，仅检测感情极性突变
  for (const cs of characterStates) {
    const rels = cs.relationships || {}
    for (const [target, rel] of Object.entries(rels)) {
      const polarity = detectRelationPolarity(rel)
      if (polarity === 'neutral') continue
      // 检查 target 与 cs 的关系是否对称
      const targetState = characterStates.find(s => s.character === target)
      if (targetState?.relationships?.[cs.character]) {
        const targetPolarity = detectRelationPolarity(targetState.relationships[cs.character])
        if (targetPolarity !== 'neutral' && polarity !== targetPolarity) {
          entries.push({
            type: 'RELATIONSHIP_DEGRADATION',
            severity: 'LOW',
            description: `「${cs.character}」→「${target}」关系(${rel})与反方向「${target}」→「${cs.character}」(${targetState.relationships[cs.character]})不对称`,
            affectedEntities: [cs.character, target],
            firstSeenAt: cs.updatedAtChapter,
            lastSeenAt: targetState.updatedAtChapter,
            detectionEvidence: `${cs.character}→${target}: ${rel} vs ${target}→${cs.character}: ${targetState.relationships[cs.character]}`,
          })
        }
      }
    }
  }
  return entries
}

function detectRelationPolarity(rel: string): 'positive' | 'negative' | 'neutral' {
  const positive = ['信任', '爱', '友', '盟友', '亲人', '朋友', '恩人', '师徒', '喜爱']
  const negative = ['恨', '敌', '仇', '背叛', '嫌', '厌恶', '对立', '对手']
  const lower = rel.toLowerCase()
  if (positive.some(w => lower.includes(w))) return 'positive'
  if (negative.some(w => lower.includes(w))) return 'negative'
  return 'neutral'
}

// ============================================================
// 漂移分数计算
// ============================================================

function computeDriftScore(entries: DriftEntry[]): number {
  if (entries.length === 0) return 0
  let score = 0
  for (const e of entries) {
    switch (e.severity) {
      case 'HIGH':   score += 0.3; break
      case 'MEDIUM': score += 0.15; break
      case 'LOW':    score += 0.05; break
    }
  }
  return Math.min(1, Math.round(score * 100) / 100)
}

// ============================================================
// 主入口
// ============================================================

export interface ScanParams {
  /** 当前章节号 */
  currentChapter: number
  /** 扫描窗口大小（默认 10） */
  window?: number
}

export async function scanRecentChapters(params: ScanParams): Promise<DriftReport> {
  const { currentChapter } = params
  const window = params.window ?? 10
  const startChapter = Math.max(1, currentChapter - window)
  const endChapter = currentChapter

  // 并行加载 Canon 数据
  const [timeline, characterStates, plotLines] = await Promise.all([
    canonStore.getTimeline(endChapter),
    canonStore.getAllCharacterStates(),
    canonStore.getPlotLines(),
  ])

  const entries: DriftEntry[] = []

  // 各维度检测
  entries.push(...detectLocationDrift(timeline, characterStates, startChapter, endChapter))
  entries.push(...detectKnowledgeDrift(timeline, characterStates, startChapter, endChapter))
  entries.push(...detectTimelineCompression(timeline, startChapter, endChapter))
  entries.push(...detectPlotThreadAbandonment(plotLines, endChapter))
  entries.push(...detectRelationshipDegradation(characterStates))

  const driftScore = computeDriftScore(entries)

  return {
    driftScore,
    entries: entries.sort((a, b) => {
      const sev = { HIGH: 0, MEDIUM: 1, LOW: 2 }
      return sev[a.severity] - sev[b.severity]
    }),
    scannedChapterRange: [startChapter, endChapter],
    generatedAt: new Date().toISOString(),
  }
}

/**
 * 检测累积性不一致（gradual drift）—— 同一实体在多个连续章节中缓慢漂移
 */
export function detectGradualInconsistency(
  report: DriftReport,
  characterStates: CharacterStateSnapshot[],
): DriftEntry[] {
  const entries: DriftEntry[] = []

  // 检测同一角色在多章中出现 LOW/MEDIUM 级别的 location drift（累积）
  const locationDrifts = report.entries.filter(e => e.type === 'CHARACTER_LOCATION_DRIFT')
  for (const ch of characterStates) {
    const mine = locationDrifts.filter(e => e.affectedEntities.includes(ch.character))
    if (mine.length >= 3) {
      entries.push({
        type: 'CHARACTER_LOCATION_DRIFT',
        severity: 'HIGH',
        description: `角色「${ch.character}」在 ${mine.length} 次检测中出现地点漂移，可能存在累积性地点不一致`,
        affectedEntities: [ch.character],
        firstSeenAt: Math.min(...mine.map(e => e.firstSeenAt)),
        lastSeenAt: Math.max(...mine.map(e => e.lastSeenAt)),
        detectionEvidence: `${mine.length} occurrences across ch${Math.min(...mine.map(e => e.firstSeenAt))}-${Math.max(...mine.map(e => e.lastSeenAt))}`,
      })
    }
  }

  return entries
}

/**
 * 格式化 drift report 为人类可读文本
 */
export function formatDriftReport(report: DriftReport): string {
  if (report.entries.length === 0) {
    return `✅ 第${report.scannedChapterRange[0]}-${report.scannedChapterRange[1]}章无漂移（score 0）`
  }

  const lines: string[] = [
    `📊 漂移报告 — 第${report.scannedChapterRange[0]}-${report.scannedChapterRange[1]}章（score ${report.driftScore}）`,
    '',
  ]

  const byType = new Map<DriftType, DriftEntry[]>()
  for (const e of report.entries) {
    if (!byType.has(e.type)) byType.set(e.type, [])
    byType.get(e.type)!.push(e)
  }

  for (const [type, items] of byType) {
    const sev = items[0].severity === 'HIGH' ? '🔴' : items[0].severity === 'MEDIUM' ? '🟡' : '🟢'
    lines.push(`## ${sev} ${type}（${items.length} 项）`)
    for (const item of items) {
      lines.push(`- ${item.description}`)
    }
    lines.push('')
  }

  lines.push(`漂移分数：${report.driftScore}（0=无漂移，1=严重漂移）`)
  return lines.join('\n')
}

/**
 * 从 scanRecentChapters 的简述中生成 prompt 层修复指引
 */
export function generateDriftFixContext(report: DriftReport): string {
  if (report.entries.length === 0) return ''

  const lines: string[] = [
    '【跨章节漂移修复指引】',
    `以下是在第${report.scannedChapterRange[0]}-${report.scannedChapterRange[1]}章检测到的累积性漂移问题：`,
    '',
  ]

  for (const e of report.entries) {
    lines.push(`- [${e.severity}] ${e.description}`)
  }

  lines.push('', '修复原则：')
  lines.push('1. 不得为修复漂移而删除已确立的关键事件')
  lines.push('2. 地点/关系/知识变更必须有明确事件支撑')
  lines.push('3. 若漂移因省略过渡段落所致，补写过渡而非修改前置事件')
  return lines.join('\n')
}
