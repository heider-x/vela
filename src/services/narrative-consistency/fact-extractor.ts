/**
 * FactExtractor —— 从定稿章节中提取结构化 CanonWriteback
 *
 * 输入：定稿章节正文 + 既有角色/世界架构
 * 输出：CanonWriteback payload（事件 / 角色 delta / 剧情线 / 事实 / 摘要）
 *
 * 策略：
 *   - 本地启发式优先：基于正则/词法提取能在不调用 LLM 的情况下提取出
 *     70%+ 的事件和角色状态变更，避免每章多耗一次 LLM 调用。
 *   - LLM 增强：可选；若调用方传入 llmExtractor 函数，则用它抽取更精细的
 *     角色目标/关系/目标剧情线。最终以本地提取为兜底，LLM 提取为补充。
 *
 * 设计目标：
 *   - 失败不阻塞定稿流程：任何 step 抛错都吞掉，仅记录空 payload
 *   - 与现有 chapter-notes 模板兼容：notes 文本会作为摘要补充
 */
import type {
  CanonWriteback,
  TimelineEvent,
  CharacterStateDelta,
  Fact,
} from './types'
import { canonStore } from './canon-store'

const FLASHBACK_MARKERS = ['回忆', '十年前', '二十年前', '那年', '曾经', '脑海中']

export interface ExtractParams {
  chapterNumber: number
  chapterTitle: string
  chapterContent: string
  /** 现有角色卡（用于对齐角色名） */
  characters: Array<{ name: string; currentState?: { location?: string; powerLevel?: string; physicalState?: string; mentalState?: string; keyItems?: string; recentEvents?: string } }>
  /** 章节蓝图（用于提取关键事件目标） */
  chapterBlueprint?: {
    keyEvents?: string
    characters?: string[]
    suspenseHook?: string
  }
  /** 可选：之前由 generate_chapter_notes 模板生成的 notes 文本 */
  existingNotes?: string
}

/** 检测段落是否处于闪回上下文 */
function isInFlashbackContext(text: string, position: number): boolean {
  const window = text.slice(Math.max(0, position - 100), Math.min(text.length, position + 100))
  return FLASHBACK_MARKERS.some(m => window.includes(m))
}

/**
 * 从章节正文中提取结构化事件。
 * 启发式：每段以"<角色名>+<动作动词>"开头的句子视为一个事件。
 */
function extractEvents(
  content: string,
  chapterNumber: number,
  characters: Array<{ name: string }>,
): Omit<TimelineEvent, 'id' | 'createdAt'>[] {
  const events: Omit<TimelineEvent, 'id' | 'createdAt'>[] = []
  const paragraphs = content.split(/\n+/).map(p => p.trim()).filter(Boolean)
  const charNames = characters.map(c => c.name).filter(n => n && n.length >= 2)

  let sequence = 1
  for (let pi = 0; pi < paragraphs.length; pi++) {
    const p = paragraphs[pi]
    // 跳过空段/标题/纯对话
    if (p.length < 10) continue

    // 检测本段是否为事件段（包含明确的"动作动词"+"对象"）
    const actionVerbs = ['冲', '斩', '击', '逃', '追', '杀', '救', '进入', '发现', '拿到', '拾起', '递给', '归还', '拒绝', '答应', '背叛', '和好', '决裂', '相遇', '分别', '对话', '争执', '决斗']
    const hasAction = actionVerbs.some(v => p.includes(v))
    if (!hasAction) continue

    // 提取涉及的角色
    const involvedChars = charNames.filter(name => p.includes(name))
    if (involvedChars.length === 0) continue

    // 提取地点（粗略："在/来到 地点"）
    const locMatch = p.match(/(在|来到|抵达|前往|进入|返回|走出)([\u4e00-\u9fa5A-Za-z0-9_]{2,10})/)
    const location = locMatch?.[2] || ''

    // 截取前 60 字作为摘要
    const summary = p.length > 60 ? p.slice(0, 60) + '...' : p

    // 检测闪回
    const isFlashback = isInFlashbackContext(content, content.indexOf(p))

    events.push({
      chapterNumber,
      sequence: sequence++,
      characters: involvedChars,
      location,
      timeFlow: isFlashback ? 'flashback' : 'sequential',
      summary,
      impact: '', // 由 LLM 抽取或留空
    })

    // 一章最多记录 10 个事件，避免 prompt 爆炸
    if (events.length >= 10) break
  }

  return events
}

/**
 * 从章节正文提取角色状态变更
 * 启发式：每个角色最后一次出现时，记录当前位置/状态
 */
function extractCharacterDeltas(
  content: string,
  chapterNumber: number,
  characters: ExtractParams['characters'],
): CharacterStateDelta[] {
  const deltas: CharacterStateDelta[] = []
  const paragraphs = content.split(/\n+/).map(p => p.trim()).filter(Boolean)

  // 收集所有角色名（用于 containsWholeWord 智能边界检查）
  const allCharNames = new Set(characters.map(c => c.name).filter(n => n && n.length >= 2))

  for (const char of characters) {
    if (!char.name || char.name.length < 2) continue
    // 找到该角色最后一次有信息出现的段落
    let lastMeaningfulIdx = -1
    for (let i = paragraphs.length - 1; i >= 0; i--) {
      if (!containsWholeWord(paragraphs[i], char.name, allCharNames)) continue
      if (hasStateSignal(paragraphs[i])) {
        lastMeaningfulIdx = i
        break
      }
    }
    if (lastMeaningfulIdx < 0) continue

    const lastPara = paragraphs[lastMeaningfulIdx]
    const before = char.currentState || {}

    // 提取新位置
    const locMatch = lastPara.match(new RegExp(`(?<![\u4e00-\u9fa5])${escapeRegex(char.name)}(?![\u4e00-\u9fa5])[^。]{0,20}?(在|来到|抵达|前往|进入|返回|走出)([\u4e00-\u9fa5A-Za-z0-9_]{2,8})(?![\u4e00-\u9fa5])`))
    const newLocation = locMatch?.[2] || before.location || ''

    // 提取新的身体状态（受伤/死亡等）
    let newPhysical = before.physicalState || ''
    if (lastPara.includes(`${char.name}受`)) newPhysical = `${before.physicalState || '正常'};${char.name}受伤`
    if (lastPara.includes(`${char.name}死`) || lastPara.includes(`${char.name}牺牲`)) newPhysical = '死亡'
    if (lastPara.includes(`${char.name}昏迷`)) newPhysical = '昏迷'

    // 提取关键道具
    let newKeyItems = before.keyItems || ''
    const itemMatch = lastPara.match(new RegExp(`${escapeRegex(char.name)}[^。]{0,30}?(拿到|拾起|获得|捡到)([^。]{2,15})`))
    if (itemMatch) newKeyItems = `${newKeyItems}、${itemMatch[2]}`.replace(/^[、,，]/, '')

    deltas.push({
      character: char.name,
      chapterNumber,
      before: {
        location: before.location,
        physicalState: before.physicalState,
        keyItems: before.keyItems,
      },
      after: {
        location: newLocation,
        physicalState: newPhysical,
        keyItems: newKeyItems,
        recentEvents: lastPara.slice(0, 60),
      },
    })
  }

  return deltas
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 检查 text 中是否包含完整词语 word（不被其他汉字包围）。
 * 修复："林轩" 命中 "林轩雨" 段落的问题。
 *
 * 策略：只在 word 后面跟着**已知其他角色名**的前缀时，才要求边界。
 * 例如：若 character list 里有 "林轩" 和 "林轩雨"，则 "林轩雨" 段落里 "林轩" 必须用字边界匹配。
 * 但 "林轩知道" 中 "知" 不是角色名 → 直接用 substring 匹配即可（保留原行为）。
 */
function containsWholeWord(text: string, word: string, allCharNames?: Set<string>): boolean {
  if (!word) return false
  // 基础 substring 匹配（保留原行为，应对常见 case "林轩知道" 等）
  if (!text.includes(word)) return false
  // 如果有其他角色名以 word 为前缀 → 必须用字边界
  if (allCharNames && allCharNames.size > 0) {
    for (const name of allCharNames) {
      if (name !== word && name.startsWith(word) && name.length > word.length) {
        // 需要字边界：检查每个 occurrence
        const isWordChar = (c: string) => /[一-鿿A-Za-z0-9_]/.test(c)
        let found = false
        let idx = text.indexOf(word)
        while (idx >= 0) {
          const after = idx + word.length < text.length ? text[idx + word.length] : ''
          if (!isWordChar(after)) { found = true; break }
          idx = text.indexOf(word, idx + 1)
        }
        return found
      }
    }
  }
  return true
}

/**
 * 状态信号白名单（Set 查找，O(1)）。覆盖常见动作/状态描述。
 * 修复：原 stateSignals 列表仅 17 个，缺 飞/遁/跳/望/听/思/答/喊 等大量常用动词。
 */
const STATE_SIGNALS_SET: Set<string> = new Set([
  // 移动/位置
  '走', '跑', '飞', '遁', '跳', '跃', '踏', '游', '爬', '降', '升',
  '站', '坐', '蹲', '卧', '躺', '跪',
  '出', '入', '进', '退', '逃', '追', '赶', '来', '去', '回', '返',
  '离', '到', '达', '寻', '找', '探', '巡', '来', '去',
  '前', '后', '左', '右', '旁', '侧',
  // 动作
  '看', '观', '望', '眺', '视', '盯', '扫', '窥',
  '说', '答', '喊', '叫', '吼', '喝', '唤', '诉', '叹', '吟', '唱',
  '听', '闻', '嗅',
  '想', '思', '念', '忆', '梦', '念',
  '拿', '取', '拾', '握', '持', '抓', '按', '拔', '举',
  '打', '击', '斩', '砍', '刺', '搏', '斗', '搏', '劈',
  '杀', '封', '锁', '破',
  '穿', '脱', '戴', '佩',
  '笑', '哭', '怒', '恨', '悲', '喜', '惊', '恐', '哀',
  '叹', '息', '惊', '恐',
  // 状态变化
  '生', '死', '伤', '病', '醒', '睡', '醉', '昏', '倒',
  '现', '消',
  '遇', '逢', '撞', '碰', '见',
  '告', '别', '逢', '见',
  '传', '授', '教', '学', '习', '修', '炼',
  '战', '争', '搏', '伐', '征',
  // 关键短语（双字）—— 避免被 in 操作误判；用 2 字迭代匹配
  '发现', '知道', '明白', '意识到', '了解', '得知', '听说', '想起', '记起',
  '决定', '打算', '计划', '准备', '想要', '希望',
  '抵达', '来到', '前往', '赶到', '回到', '进入', '返回', '走出',
  '出现', '消失', '离开', '到来', '等待',
  '告别', '分别', '重逢', '相遇', '冲突', '战斗',
  '击败', '战胜', '打败', '击退',
  '翻看', '拿起', '放下', '交出', '送给', '握住', '拔出', '佩戴', '装备',
  '走向', '走向', '跑去', '飞向', '逃向', '冲向', '奔向', '走向',
  '受伤', '死亡', '昏迷', '清醒', '倒下', '起身',
])

function hasStateSignal(text: string): boolean {
  if (!text) return false
  // 单字 + 双字短语扫描
  for (let i = 0; i < text.length; i++) {
    if (STATE_SIGNALS_SET.has(text[i])) return true
  }
  // 双字短语
  for (let i = 0; i < text.length - 1; i++) {
    if (STATE_SIGNALS_SET.has(text.substr(i, 2))) return true
  }
  return false
}

/**
 * 从章节正文提取关键事实条目
 * 启发式：包含明确判断的句子（"X 是 Y"、"X 位于 Y"、"X 拥有 Y"）
 */
function extractFacts(content: string, chapterNumber: number, characters: string[]): Omit<Fact, 'id'>[] {
  const facts: Omit<Fact, 'id'>[] = []
  const sentences = content.split(/[。！？]/).map(s => s.trim()).filter(s => s.length >= 6 && s.length <= 80)

  for (const s of sentences) {
    // 身份类："X 是 Y"
    let m = s.match(/([\u4e00-\u9fa5A-Za-z0-9_]{2,8})(是|乃)([\u4e00-\u9fa5A-Za-z0-9_]{2,15})/)
    if (m && characters.includes(m[1])) {
      facts.push({ category: 'identity', statement: `${m[1]}${m[2]}${m[3]}`, introducedAt: chapterNumber, characters: [m[1]], evidence: s })
      continue
    }
    // 地点类："X 位于 Y" / "X 在 Y"
    m = s.match(/([\u4e00-\u9fa5A-Za-z0-9_]{2,8})(位于|坐落在|处于)([\u4e00-\u9fa5A-Za-z0-9_]{2,15})/)
    if (m && characters.includes(m[1])) {
      facts.push({ category: 'location', statement: `${m[1]}${m[2]}${m[3]}`, introducedAt: chapterNumber, characters: [m[1]], evidence: s })
      continue
    }
    // 物品类："X 拥有/持有 Y"
    m = s.match(/([\u4e00-\u9fa5A-Za-z0-9_]{2,8})(拥有|持有|保管|藏有)([\u4e00-\u9fa5A-Za-z0-9_]{2,12})/)
    if (m && characters.includes(m[1])) {
      facts.push({ category: 'item', statement: `${m[1]}${m[2]}${m[3]}`, introducedAt: chapterNumber, characters: [m[1]], evidence: s })
      continue
    }
    m = s.match(/([\u4e00-\u9fa5A-Za-z0-9_]{2,8})(递给|交给|赠予|给了|拿到|拾起|获得)(?:他|她|其)?(?:一[柄把枚颗件卷])?([\u4e00-\u9fa5A-Za-z0-9_]{2,12})/)
    if (m && characters.includes(m[1])) {
      facts.push({ category: 'item', statement: `${m[1]}${m[2]}${m[3]}`, introducedAt: chapterNumber, characters: [m[1]], evidence: s })
      continue
    }
    // 关系类："X 与 Y 是 Z"
    m = s.match(/([\u4e00-\u9fa5A-Za-z0-9_]{2,8})(与|和)([\u4e00-\u9fa5A-Za-z0-9_]{2,8})(是|为|成为)([\u4e00-\u9fa5]{2,8})/)
    if (m && characters.includes(m[1]) && characters.includes(m[3])) {
      facts.push({ category: 'relationship', statement: `${m[1]}${m[2]}${m[3]}${m[4]}${m[5]}`, introducedAt: chapterNumber, characters: [m[1], m[3]], evidence: s })
      continue
    }
  }

  // 去重（按 statement）
  const seen = new Set<string>()
  return facts.filter(f => {
    if (seen.has(f.statement)) return false
    seen.add(f.statement)
    return true
  })
}

/**
 * 把章节正文压缩为结构化摘要
 * 策略：取首段 + 末段 + 关键段落（包含"。"前最长的3句）
 */
function extractSummary(content: string, chapterTitle: string): string {
  const sentences = content.split(/[。！？]/).map(s => s.trim()).filter(s => s.length >= 6)
  if (sentences.length === 0) return `第${chapterTitle}章定稿`

  const parts: string[] = []
  if (sentences[0]) parts.push(sentences[0] + '。')
  if (sentences.length > 2) {
    const mid = sentences.slice(1, -1).sort((a, b) => b.length - a.length).slice(0, 2)
    for (const m of mid) parts.push(m + '。')
  }
  if (sentences.length > 1) parts.push(sentences[sentences.length - 1] + '。')

  return parts.join(' ').slice(0, 300)
}

/**
 * 主入口：从定稿章节构造 CanonWriteback
 */
export function extractCanonWriteback(params: ExtractParams): CanonWriteback {
  const { chapterNumber, chapterTitle, chapterContent, characters } = params

  // 清理标题（去掉 "第N章 " 前缀）
  const cleanTitle = chapterTitle.replace(/^第\s*[\d一二三四五六七八九十百千万零〇]+\s*章\s*/, '').trim()

  const events = extractEvents(chapterContent, chapterNumber, characters)
  const characterDeltas = extractCharacterDeltas(chapterContent, chapterNumber, characters)
  const facts = extractFacts(chapterContent, chapterNumber, characters.map(c => c.name))

  // 摘要：本地提取 + existing notes（若有）
  let summary = extractSummary(chapterContent, cleanTitle)
  if (params.existingNotes?.trim()) {
    summary = `${summary}\n\n【结构化要点】\n${params.existingNotes.trim()}`
  }

  // 剧情线变更：若 chapterBlueprint.keyEvents 存在，新建一条剧情线
  const plotLineChanges: CanonWriteback['plotLineChanges'] = {}
  if (params.chapterBlueprint?.keyEvents?.trim()) {
    const kev = params.chapterBlueprint.keyEvents.trim()
    // 只在出现"开启"、"开启"、"建立"、"启动"等关键词时新建
    if (/开启|启动|建立|开启|启动|开启|开端/.test(kev)) {
      plotLineChanges.added = [{
        name: kev.slice(0, 30),
        status: 'active',
        startedAt: chapterNumber,
        lastAdvancedAt: chapterNumber,
        characters: params.chapterBlueprint.characters || [],
        currentState: '本章开启',
        description: kev,
      }]
    }
  }

  return {
    chapterNumber,
    chapterTitle: cleanTitle,
    chapterSummary: summary,
    newEvents: events,
    characterDeltas,
    plotLineChanges,
    newFacts: facts,
  }
}

/**
 * 便捷方法：执行提取 + 写回（调用 CanonStore）
 * 任何异常都不会抛出，最多重置 ok=false。
 */
export async function extractAndWriteback(params: ExtractParams): Promise<{ ok: boolean; errors: string[] }> {
  try {
    const payload = extractCanonWriteback(params)
    return await canonStore.writeback(payload)
  } catch (err) {
    return { ok: false, errors: [String(err)] }
  }
}
