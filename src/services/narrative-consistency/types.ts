/**
 * Narrative Consistency 类型定义
 *
 * CanonContext —— 生成前注入的统一上下文（不可变优先级）
 * TimelineEvent —— 结构化时间线事件
 * CharacterState —— 动态角色状态（按章节更新，含 knowledge/relationships/goal）
 * PlotLine —— 长期未结剧情线
 * Fact —— 客观事实条目
 */

/** 单个角色在某章时间点的状态快照（增量式） */
export interface CharacterStateSnapshot {
  /** 角色名（唯一） */
  character: string
  /** 当前所在地点（字符串，存为最大可能匹配的地点名） */
  location: string
  /** 当前修为/境界 */
  powerLevel: string
  /** 身体状态（伤势/异常） */
  physicalState: string
  /** 心理状态（情绪/愿望/恐惧） */
  mentalState: string
  /** 当前持有的关键道具/资源（逗号或顿号分隔） */
  keyItems: string
  /** 角色当前目标（推动剧情的当下任务） */
  currentGoal: string
  /** 该角色当前拥有的 known facts（信息集合），用于越权检测 */
  knowledge: string[]
  /** 与其他角色的关系映射（角色名 -> 关系描述） */
  relationships: Record<string, string>
  /** 最近事件摘要 */
  recentEvents: string
  /** 状态更新来源的章节号 */
  updatedAtChapter: number
  /** 状态更新时间戳 ISO 字符串 */
  updatedAt: string
}

/** 单条结构化时间线事件 */
export interface TimelineEvent {
  /** 唯一 id（自增或 UUID） */
  id?: number
  /** 所属章节号 */
  chapterNumber: number
  /** 章节内的顺序（同一章内从 1 开始） */
  sequence: number
  /** 涉及角色（数组） */
  characters: string[]
  /** 发生地点 */
  location: string
  /** 时间标签：sequential=顺序推进；flashback=闪回（必须显式标记） */
  timeFlow: 'sequential' | 'flashback'
  /** 事件简短摘要（<= 60 字） */
  summary: string
  /** 影响描述：人物/关系/物品变化（自由文本） */
  impact: string
  /** 创建时间 */
  createdAt?: string
}

/** 长期未结剧情线 */
export interface PlotLine {
  id?: number
  /** 剧情线名（短名） */
  name: string
  /** 剧情线状态：active=进行中；resolved=已解决；paused=暂缓 */
  status: 'active' | 'resolved' | 'paused'
  /** 起始章节号 */
  startedAt: number
  /** 最新一次推进的章节号 */
  lastAdvancedAt: number
  /** 解决章节号（status=resolved 时有效） */
  resolvedAt?: number
  /** 涉及角色 */
  characters: string[]
  /** 当前进度描述 */
  currentState: string
  /** 完整描述（背景/伏笔/悬念） */
  description: string
}

/** 客观事实条目（短句） */
export interface Fact {
  id?: number
  /** 事实所属类别：world/location/item/event/relationship/identity */
  category: 'world' | 'location' | 'item' | 'event' | 'relationship' | 'identity'
  /** 事实简短陈述（<= 80 字） */
  statement: string
  /** 引入章节 */
  introducedAt: number
  /** 涉及角色 */
  characters: string[]
  /** 关键证据短语（用于自动校验） */
  evidence?: string
}

/** 生成前注入的 CanonContext —— 按固定优先级排序 */
export interface CanonContext {
  /** 世界观 / 设定基础（不可违背） */
  worldRules: string
  /** 静态人物图谱（来自架构层） */
  characterArch: string
  /** 角色当前动态状态（最高优先级，生成时不可推翻） */
  characterStates: CharacterStateSnapshot[]
  /** 已发生事件（按章节排序，严格单向） */
  timeline: TimelineEvent[]
  /** 最近 N 章摘要 */
  recentChapterSummaries: string
  /** 未解决剧情线 */
  openPlotLines: PlotLine[]
  /** 当前章节目标 */
  chapterGoal: string
  /** 已知事实摘要（短文本） */
  knownFacts: Fact[]
  /** 上一章结尾（用于衔接） */
  previousEnding: string
  /** RAG 检索结果（最低优先级） */
  ragContext: string
  /** 风格要求 */
  writingStyle: string
  /** 全局行文指导 */
  globalGuidance: string
  /** 硬性约束（生成约束清单） */
  hardConstraints: string
  /** 元数据：构造时间 / 章节号 */
  meta: {
    chapterNumber: number
    builtAt: string
    ragSources: number
  }
}

/** 一致性校验问题 */
export interface ConsistencyIssue {
  severity: 'error' | 'warning' | 'info'
  category:
    | 'location'
    | 'knowledge'
    | 'timeline'
    | 'relationship'
    | 'event-order'
    | 'item'
    | 'continuity'
  message: string
  /** 相关角色（可选） */
  characters?: string[]
  /** 涉及章节号（可选） */
  chapterNumber?: number
  /** 证据短语（可选） */
  evidence?: string
}

/** 校验结果 */
export interface ConsistencyReport {
  issues: ConsistencyIssue[]
  /** 是否自动修复成功 */
  autoFixed: boolean
  /** 自动修复后的内容（若未修复则等于原内容） */
  repairedContent?: string
  /** 报告生成时间 */
  generatedAt: string
}

/** 角色状态变更 delta（用于写回） */
export interface CharacterStateDelta {
  character: string
  /** 旧值（仅当发生变化时填写） */
  before?: Partial<CharacterStateSnapshot>
  /** 新值 */
  after: Partial<CharacterStateSnapshot>
  /** 来源章节号 */
  chapterNumber: number
}

/** 章节定稿时的写回 payload */
export interface CanonWriteback {
  chapterNumber: number
  chapterTitle: string
  chapterSummary: string
  /** 本章新增事件 */
  newEvents: Omit<TimelineEvent, 'id' | 'createdAt'>[]
  /** 角色状态变更 */
  characterDeltas: CharacterStateDelta[]
  /** 新增/推进/解决的剧情线 */
  plotLineChanges: {
    added?: Omit<PlotLine, 'id'>[]
    advanced?: Array<{ id: number; currentState: string; lastAdvancedAt: number }>
    resolved?: number[]
  }
  /** 新增事实 */
  newFacts: Omit<Fact, 'id'>[]
}

/** 章节摘要（用于 recentChapterSummaries） */
export interface ChapterSummary {
  chapterNumber: number
  title: string
  summary: string
  createdAt: string
}
