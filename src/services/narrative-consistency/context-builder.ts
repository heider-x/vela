/**
 * CanonContextBuilder —— 生成前构造 CanonContext
 *
 * 输入：项目状态（架构、角色卡、章节蓝图等）+ 目标章节信息
 * 输出：按固定优先级排序的 CanonContext（用于 prompt 注入）
 *
 * 注入顺序（强制）：
 *   1. 正史设定（不可违背）
 *   2. 当前人物状态（最高优先级）
 *   3. 时间线（严格排序）
 *   4. 最近章节摘要
 *   5. 未解决剧情
 *   6. 当前章节目标
 *   7. RAG 参考内容（最低优先级）
 *   8. 风格要求
 *   9. 硬性约束（禁止矛盾）
 */
import type { CanonContext, TimelineEvent, CharacterStateSnapshot, PlotLine, Fact, ChapterSummary } from './types'
import { canonStore } from './canon-store'

/** 构建入参 */
export interface BuildCanonContextParams {
  chapterNumber: number
  /** 全书架构（来自 db:project-core-get） */
  architecture: {
    premise: string
    charactersArch: string
    worldbuilding: string
    synopsis: string
  }
  /** 现有角色卡（来自 db:character-get-all） */
  characters: Array<{
    name: string
    role: string
    currentState?: {
      location?: string
      powerLevel?: string
      physicalState?: string
      mentalState?: string
      keyItems?: string
      recentEvents?: string
      updatedAtChapter?: number
    }
  }>
  /** 当前章节蓝图 */
  chapterGoal: string
  /** 上一章结尾（用于衔接） */
  previousEnding: string
  /** 知识库检索结果 */
  ragContext: string
  /** 写作风格 */
  writingStyle: string
  /** 全局行文指导 */
  globalGuidance: string
  /** 时间线窗口：返回到多少章之前的所有事件（默认 = chapterNumber - 1） */
  timelineWindow?: number
  /** 最近章节摘要数量（默认 3） */
  recentSummaryCount?: number
}

export const HARD_CONSTRAINTS = `【硬性叙事一致性约束（违反任何一条都会被视为错误）】

1. 不得改变已发生事实：上文明确写过的事件、状态、事实，本章不得推翻、改写或自相矛盾。
2. 不得让人物凭空知道未获得的信息：信息只能通过对话、书信、目击、推理等方式习得。若人物对某事做出反应，必须在文本中有先行的信息来源。
3. 不得无解释改变地点：人物在两个段落间不得瞬移到不同地点，必须有行动/转场。
4. 不得无解释改变人物关系：关系恶化或修复必须有明确触发事件。
5. 不得打乱时间线顺序：本章事件必须发生在上一章事件之后（除非显式标注闪回，并在文本中以"回忆"、"十年前"、"那天"等标记开始）。
6. 必须自然衔接上一章节：起笔必须从上一章结尾的场景/状态平滑过渡，禁止场景瞬移、视角跳跃。
7. 不得让人物持有未获得的物品：物品归属变更必须有拾取/购买/赠予/夺取等明确描写。
8. 不得让已死的角色出场（除非是闪回或鬼魂设定，并需显式标记）。
9. 设定一经确立不得违反：本章不能引入与世界观/力量体系/角色背景设定冲突的新元素。
10. 如确需闪回，必须显式以"回忆"、"十年前"、"脑海中浮现"等词语标记，并在结束时回到当前时间。`

/**
 * 转义 LLM 写入字段中的模板变量（{{xxx}}），防止 prompt 注入。
 * 把 {{ 转义为 ⦃⦃，}} 转义为 ⦄⦄ — LLM 仍可读但 prompt-builder.replaceAll 不命中。
 * 同时截断到 500 字以防超长字段撑爆 prompt。
 */
function escapeTemplateVars(text: string): string {
  if (!text) return text
  return text
    .replace(/\{\{/g, '⦃⦃')
    .replace(/\}\}/g, '⦄⦄')
    .slice(0, 500)
}

/** 把时间线事件格式化为简洁文本 */
function formatTimeline(events: TimelineEvent[]): string {
  if (events.length === 0) return ''
  return events
    .map(e => `[第${e.chapterNumber}章·#${e.sequence}] ${e.timeFlow === 'flashback' ? '[闪回] ' : ''}` +
      `${(e.characters || []).join('、') || '（无角色）'} 在「${e.location || '未知地点'}」：` +
      `${escapeTemplateVars(e.summary)}${e.impact ? `（影响：${escapeTemplateVars(e.impact)}）` : ''}`)
    .join('\n')
}

/** 把角色当前状态格式化为文本 */
function formatCharacterStates(states: CharacterStateSnapshot[]): string {
  if (states.length === 0) return ''
  return states
    .map(s => {
      const knowledge = s.knowledge?.length ? ` | 已知：${escapeTemplateVars(s.knowledge.join('；'))}` : ''
      const relations = s.relationships && Object.keys(s.relationships).length
        ? ` | 关系：${Object.entries(s.relationships).map(([k, v]) => `${k}→${v}`).join('；')}`
        : ''
      const goal = s.currentGoal ? ` | 当前目标：${escapeTemplateVars(s.currentGoal)}` : ''
      return `- ${s.character} | 地点：${s.location || '未知'} | 境界：${s.powerLevel || '未知'} | ` +
        `身体：${s.physicalState || '正常'} | 心理：${s.mentalState || '正常'} | ` +
        `道具：${s.keyItems || '无'} | 最近：第${s.updatedAtChapter}章 ${escapeTemplateVars(s.recentEvents || '')}${goal}${knowledge}${relations}`
    })
    .join('\n')
}

/** 把未结剧情线格式化为文本 */
function formatOpenPlotLines(lines: PlotLine[]): string {
  if (lines.length === 0) return ''
  return lines
    .map(l => `- [${l.status}] ${escapeTemplateVars(l.name)}（起始第${l.startedAt}章，最近推进第${l.lastAdvancedAt}章）` +
      `：${escapeTemplateVars(l.currentState)} | 涉及：${(l.characters || []).join('、') || '—'}`)
    .join('\n')
}

/** 把事实条目格式化为短文本 */
function formatFacts(facts: Fact[]): string {
  if (facts.length === 0) return ''
  // 取最近 30 条避免 prompt 过大
  return facts
    .slice(-30)
    .map(f => {
      const statement = escapeTemplateVars(f.statement)
      const evidence = f.evidence ? `，证据："${escapeTemplateVars(f.evidence)}"` : ''
      return `- [${f.category}] ${statement}（引入第${f.introducedAt}章${evidence}）`
    })
    .join('\n')
}

/** 把章节摘要格式化为文本 */
function formatRecentSummaries(summaries: ChapterSummary[]): string {
  if (summaries.length === 0) return ''
  return summaries
    .map(s => `【第${s.chapterNumber}章${s.title ? ' ' + s.title : ''}】\n${escapeTemplateVars(s.summary)}`)
    .join('\n\n')
}

/**
 * 构造 CanonContext —— 按强制优先级顺序注入。
 *
 * 该函数是叙事一致性的"闸门"：所有生成/修稿/审稿驱动修稿命令都必须经过它。
 * 任何字段读取失败都必须用安全默认值（空字符串/空数组），确保主流程不被打断。
 */
export async function buildCanonContext(params: BuildCanonContextParams): Promise<CanonContext> {
  const timelineWindow = params.timelineWindow ?? Math.max(0, params.chapterNumber - 1)
  const recentSummaryCount = params.recentSummaryCount ?? 3

  // 并行读取所有 Canon Store 数据 + 角色卡（角色卡从参数传入，避免重复 IPC）
  const [timeline, summaries, plotLines, facts, canonCharStates] = await Promise.all([
    canonStore.getTimeline(timelineWindow),
    canonStore.getRecentSummaries(recentSummaryCount),
    canonStore.getActivePlotLines(),
    canonStore.getFacts(),
    canonStore.getAllCharacterStates(),
  ])

  // 角色当前状态：合并 canon 表与角色卡 currentState，canon 表优先
  const mergedStates = mergeCharacterStates(canonCharStates, params.characters)

  // 拼装 world rules = premise + worldbuilding + charactersArch + synopsis
  const worldRules = [
    params.architecture.premise?.trim(),
    params.architecture.worldbuilding?.trim(),
  ].filter(Boolean).join('\n\n---\n\n')

  const characterArch = [
    params.architecture.charactersArch?.trim(),
    params.architecture.synopsis?.trim(),
  ].filter(Boolean).join('\n\n---\n\n')

  return {
    worldRules,
    characterArch,
    characterStates: mergedStates,
    timeline,
    recentChapterSummaries: formatRecentSummaries(summaries),
    openPlotLines: plotLines,
    chapterGoal: params.chapterGoal || '（无本章目标）',
    knownFacts: facts,
    previousEnding: params.previousEnding || '（无上一章结尾）',
    ragContext: params.ragContext || '（无 RAG 检索结果）',
    writingStyle: params.writingStyle || '（无风格要求）',
    globalGuidance: params.globalGuidance || '（无全局行文指导）',
    hardConstraints: HARD_CONSTRAINTS,
    meta: {
      chapterNumber: params.chapterNumber,
      builtAt: new Date().toISOString(),
      ragSources: countRagSources(params.ragContext),
    },
  }
}

/** 合并角色当前状态：canon 优先级 > 角色卡 currentState */
function mergeCharacterStates(
  canonStates: CharacterStateSnapshot[],
  cards: BuildCanonContextParams['characters'],
): CharacterStateSnapshot[] {
  const map = new Map<string, CharacterStateSnapshot>()

  for (const s of canonStates) {
    map.set(s.character, s)
  }

  for (const c of cards) {
    if (!c.name) continue
    const existing = map.get(c.name)
    const cs = c.currentState
    if (existing) {
      // 用角色卡的字段覆盖 canon 中为空的字段
      map.set(c.name, {
        ...existing,
        location: existing.location || cs?.location || '',
        powerLevel: existing.powerLevel || cs?.powerLevel || '',
        physicalState: existing.physicalState || cs?.physicalState || '',
        mentalState: existing.mentalState || cs?.mentalState || '',
        keyItems: existing.keyItems || cs?.keyItems || '',
        recentEvents: existing.recentEvents || cs?.recentEvents || '',
        updatedAtChapter: existing.updatedAtChapter || cs?.updatedAtChapter || 0,
      })
    } else {
      map.set(c.name, {
        character: c.name,
        location: cs?.location || '',
        powerLevel: cs?.powerLevel || '',
        physicalState: cs?.physicalState || '',
        mentalState: cs?.mentalState || '',
        keyItems: cs?.keyItems || '',
        currentGoal: '',
        knowledge: [],
        relationships: {},
        recentEvents: cs?.recentEvents || '',
        updatedAtChapter: cs?.updatedAtChapter || 0,
        updatedAt: new Date().toISOString(),
      })
    }
  }

  return Array.from(map.values()).sort((a, b) => a.character.localeCompare(b.character))
}

/** 把 RAG 上下文里的 [N] 标记数量作为来源数估算 */
function countRagSources(ragContext: string): number {
  if (!ragContext) return 0
  const matches = ragContext.match(/\[\d+\]/g)
  return matches ? matches.length : 0
}

/**
 * 把 CanonContext 渲染为单段 prompt 文本（按指定顺序）
 *
 * 顺序固定：正史设定 → 人物状态 → 时间线 → 章节摘要 → 未结剧情 → 本章目标 → RAG → 风格 → 全局指导 → 硬性约束
 */
export function renderCanonContext(ctx: CanonContext): string {
  const blocks: Array<{ title: string; content: string }> = [
    { title: '【正史设定（不可违背）】', content: ctx.worldRules },
    { title: '【人物群像（静态设定）】', content: ctx.characterArch },
    { title: '【当前人物状态（最高优先级 · 生成时不得推翻）】', content: formatCharacterStates(ctx.characterStates) },
    { title: '【已发生事件时间线（严格单向 · 按章节+顺序排列）】', content: formatTimeline(ctx.timeline) },
    { title: '【最近章节摘要】', content: ctx.recentChapterSummaries },
    { title: '【未结剧情线（必须在写作时考虑推进或避免冲突）】', content: formatOpenPlotLines(ctx.openPlotLines) },
    { title: '【关键事实条目（不可推翻）】', content: formatFacts(ctx.knownFacts) },
    { title: '【上一章结尾（必须自然衔接）】', content: ctx.previousEnding },
    { title: '【本章写作目标】', content: ctx.chapterGoal },
    { title: '【知识库参考（最低优先级 · 仅当与上述 canon 冲突时以 canon 为准）】', content: ctx.ragContext },
    { title: '【文风要求】', content: ctx.writingStyle },
    { title: '【全局行文指导】', content: ctx.globalGuidance },
    { title: '【硬性约束（必须严格遵守）】', content: ctx.hardConstraints },
  ]

  return blocks
    .filter(b => b.content && b.content.trim().length > 0 && !/^（无/.test(b.content.trim()))
    .map(b => `${b.title}\n${b.content}`)
    .join('\n\n---\n\n')
}
