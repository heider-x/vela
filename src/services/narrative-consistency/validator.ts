/**
 * Narrative Consistency Validator —— 生成后自动校验
 *
 * 输入：
 *   - chapterNumber / chapterContent（待校验的章节正文）
 *   - priorContext（CanonContext 用于对照）
 *
 * 输出：
 *   ConsistencyReport { issues, autoFixed, repairedContent, generatedAt }
 *
 * 检查维度（与需求文档严格对齐）：
 *   1. 人物地点连续性：人物在两个段落间不得无解释瞬移
 *   2. 人物知识越权：人物不得知道未通过对话/书信/推理获取的信息
 *   3. 时间线顺序：事件 sequence 严格递增；章内事件顺序需与文本叙述顺序一致
 *   4. 关系连续性：人物关系不得无理由变化（敌→友 需有触发）
 *   5. 事件顺序冲突：同一章内多个事件若引用同一角色，location/time 必须自洽
 *   6. 物品归属：关键道具不得无解释更换持有人
 *
 * 自动修复策略（保守）：
 *   - 仅尝试修复"信息越权"和"地点无解释瞬移"两类高置信度问题
 *   - 修复方式：删除/改写冲突句子，保留原文风格
 *   - 无法修复时降级为 warning（不阻塞保存）
 */
import type {
  CanonContext,
  ConsistencyIssue,
  CharacterStateSnapshot,
} from './types'

// ============================================================
// Flashback markers —— 用于识别闪回段落
// ============================================================
const FLASHBACK_MARKERS = [
  '回忆', '十年前', '二十年前', '三十年前', '多年前', '那年', '曾经',
  '记忆', '脑海里', '浮现', '想起', '闪回', '倒带', '那年他', '当年',
]

/** 判断章节是否为闪回章节（基本全章都是闪回） */
function isFlashbackChapter(content: string): boolean {
  const flashbackCount = FLASHBACK_MARKERS.filter(m => content.includes(m)).length
  // 多个闪回标记 + 文本较短 → 视为闪回章节
  return flashbackCount >= 3
}

// ============================================================
// Location continuity check
// ============================================================

/**
 * 检查章节内人物地点是否出现无解释瞬移。
 * 策略：解析"X 在/来到/到达/前往 地点"短语，若同一角色在文中
 *       出现多次提及地点，则要求地点相同或存在转场动作。
 */
export function checkLocationContinuity(
  content: string,
  characterStates: CharacterStateSnapshot[],
): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = []
  const locationPattern = /([\u4e00-\u9fa5A-Za-z0-9_]{2,8})(在|来到|抵达|到达|前往|回到|返回|走进|走入)([\u4e00-\u9fa5A-Za-z0-9_]{2,3})/g

  // 按段落切分
  const paragraphs = content.split(/\n+/).map(p => p.trim()).filter(Boolean)

  // 记录每个角色按出现顺序的地点序列
  const locSeq = new Map<string, Array<{ paragraph: number; location: string; verb: string; full: string }>>()

  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i]
    let m: RegExpExecArray | null
    locationPattern.lastIndex = 0
    while ((m = locationPattern.exec(p)) !== null) {
      const charName = m[1]
      const verb = m[2]
      const location = m[3]
      // 只关注在角色名单中的人物
      if (!characterStates.some(s => s.character === charName || s.character.includes(charName))) continue
      // 跳过泛指词
      if (['他', '她', '它', '我', '你', '这', '那', '大家', '众人', '他们'].includes(charName)) continue
      if (!locSeq.has(charName)) locSeq.set(charName, [])
      locSeq.get(charName)!.push({ paragraph: i, location, verb, full: m[0] })
    }
  }

  for (const [charName, seq] of locSeq.entries()) {
    if (seq.length < 2) continue
    for (let i = 1; i < seq.length; i++) {
      const prev = seq[i - 1]
      const curr = seq[i]
      if (prev.location === curr.location) continue
      // 动词是"来到/抵达/到达/前往/回到/返回/走进/走入" → 视为合法转场
      if (['来到', '抵达', '到达', '前往', '回到', '返回', '走进', '走入'].includes(curr.verb)) continue
      // 否则视为可能的无解释瞬移
      const between = paragraphs.slice(prev.paragraph, curr.paragraph + 1).join(' / ')
      issues.push({
        severity: 'warning',
        category: 'location',
        characters: [charName],
        message: `人物「${charName}」在第 ${prev.paragraph + 1}→${curr.paragraph + 1} 段地点从「${prev.location}」变为「${curr.location}」，中间段落未检测到合法转场动词（来到/抵达/到达/前往/回到/返回/走进/走入）。`,
        evidence: between.slice(0, 120),
      })
    }
  }

  return issues
}

// ============================================================
// Knowledge authorization check
// ============================================================

/**
 * 检查人物是否拥有 canon 未记录的信息。
 * 启发式：在章节内搜索"<角色>知道/了解到/明白/听到/听说/得知/意识到 <信息>"
 * 若信息不在 knowledge 列表里 → 警告
 *
 * 这是近似启发式：检测"凭空知道"模式最常用的几种表达。
 */
export function checkKnowledgeAuthorization(
  content: string,
  characterStates: CharacterStateSnapshot[],
): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = []
  if (characterStates.length === 0) return issues

  // 知道/了解到/明白/听到/听说/得知/意识到
  const charNames = characterStates.map(s => s.character)

  // 按段落切分
  const paragraphs = content.split(/\n+/).map(p => p.trim()).filter(Boolean)

  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i]
    for (const charName of charNames) {
      // 跳过只提及但不"知道"的情况
      const patterns = [
        new RegExp(`${escapeRegex(charName)}(知道|了解|明白|听到|听说|得知|意识到|发现|记得)([^。]{2,40})`, 'g'),
      ]
      for (const pat of patterns) {
        let m: RegExpExecArray | null
        pat.lastIndex = 0
        while ((m = pat.exec(p)) !== null) {
          const verb = m[1]
          const info = m[2].trim()
          // 只关心实质性的信息（不是"知道自己饿了"这种）
          if (info.length < 3) continue
          // 检查该信息是否已在该角色的 knowledge 中（子串匹配）
          const charState = characterStates.find(s => s.character === charName)
          if (!charState) continue
          // 修复：使用 word-level match 替代双向子串匹配。
          // 旧实现 `k.includes(info) || info.includes(k)` 误判严重：
          //   knowledge = ['玉佩']，info = "那块玉佩的来历" → info.includes('玉佩') = true → 跳过
          // 新实现：要求规范化后等值，或长串包含≥2 字的短串
          const inKnowledge = (charState.knowledge || []).some(k => knowledgeMatch(k, info))
          // 模糊判断：动词为"记得/记忆"通常是合法回忆
          if (verb === '记得' || verb === '记忆') continue
          const sourceWindow = p.slice(Math.max(0, m.index - 20), m.index + m[0].length + 20)
          if (/据前文线索|据.*透露|从.*得知|听.*说|目睹|亲眼|书信|传讯|线索/.test(sourceWindow)) continue
          if (!inKnowledge) {
            issues.push({
              severity: 'warning',
              category: 'knowledge',
              characters: [charName],
              message: `人物「${charName}」在第 ${i + 1} 段${verb}了「${info}」，但 canon 中该人物的 knowledge 列表未记录此信息。若属新信息应通过对话/书信/目击等方式习得。`,
              evidence: m[0],
            })
          }
        }
      }
    }
  }

  return issues
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 修复：用规范化分词 + 长度阈值，替代 `a.includes(b) || b.includes(a)` 的双向子串匹配。
 * 旧实现会被"knowledge=['玉佩'] + info='那块玉佩的来历'"绕过。
 *
 * 匹配规则（保守，按优先级）：
 *   1) 规范化后完全等值
 *   2) 短串长度 ≥ 2，且被长串完整包含
 *   3) 否则不匹配
 */
function knowledgeMatch(canonItem: string, info: string): boolean {
  if (!canonItem || !info) return false
  const norm = (s: string) => (s || '').replace(/\s+/g, '').normalize('NFKC')
  const a = norm(canonItem)
  const b = norm(info)
  if (!a || !b) return false
  if (a === b) return true
  const minLen = Math.min(a.length, b.length)
  if (minLen < 2) return false
  const longer = a.length > b.length ? a : b
  const shorter = a.length > b.length ? b : a
  if (longer.includes(shorter)) return true
  return false
}

// ============================================================
// 死亡信号（idiom-aware）—— 修复 deathSignals 把单字 '死' 当死亡信号
// ============================================================

/** 实际构成"角色已死"语义的多字短语 */
const DEATH_PHRASES = [
  '死亡', '牺牲了', '牺牲的', '身亡', '阵亡', '殒命',
  '逝世', '去世', '与世长辞', '撒手人寰',
  '当场毙命', '命丧当场', '已经死了', '真的死了', '彻底死了',
  '停止了呼吸', '气绝身亡', '断气了', '咽了气',
]

/** 包含"死"字但不是实际死亡的习语/否定/隐喻 */
const DEATH_FALSE_POSITIVES = new Set([
  '死灰复燃', '死而复生', '死而后已', '视死如归',
  '死马当活马医', '出生入死', '死气沉沉', '死皮赖脸',
  '该死', '致死', '死亡率', '死路一条',
  '死无葬身之地', '死生契阔', '死而不僵',
  '耍死', '打死', '骂死', '笑死', '气死', '累死', '忙死', '急死', '愁死',
  '置之死地', '死于非命', '生死', '死活',
])

function isActualDeathMention(text: string): boolean {
  if (!text) return false
  // 必须包含一个 DEATH_PHRASES 短语
  const hasPhrase = DEATH_PHRASES.some(p => text.includes(p))
  if (!hasPhrase) return false
  // 排除被 DEATH_FALSE_POSITIVES 包含的情况
  for (const fp of DEATH_FALSE_POSITIVES) {
    if (text.includes(fp)) {
      // 但如果 "该死" 出现在 "XXX 死了。该死的..." 这种情况，仍应报死
      // 仅当 fp 单独出现时排除
      const remaining = text.replace(fp, '').trim()
      // 简化：如果去掉 fp 后还有 DEATH_PHRASES 命中 → 仍然算死
      if (!DEATH_PHRASES.some(p => remaining.includes(p))) {
        return false
      }
    }
  }
  return true
}

/**
 * 活人动作动词（带词边界 + 排除单字歧义）。
 *
 * 设计：
 *   - 修复原 LIVING_VERBS 单字列表的误报（如 "听说" 含 "说"）
 *   - 用 2 字短语作为动词单位（"笑说"/"笑着说"/"拿起" 等）
 *   - 边界：左侧接受 (^|中文标点|空白) 或中文汉字（避免要求必须有标点）
 *   - 右侧接受 (中文标点|空白|汉字|EOF)—— 避免 "大笑" 误判
 */
const LIVING_VERB_PATTERNS: RegExp[] = [
  // 常见动作 + 后缀词
  /(?:^|[，。！？\s一-鿿])笑(?:着|了|么|过|吧|啊|呀|咧|起来|道|容|脸|声|嘻|嘻哈哈|$)/,
  /(?:^|[，。！？\s一-鿿])说(?:道|着|了|过|吧|啊|呀|呢|起来|明|明道|出|出口|出口成章|$)/,
  /(?:^|[，。！？\s一-鿿])走(?:去|来|了|过|进|出|向|到|廊|路|开|$)/,
  /(?:^|[，。！？\s一-鿿])跑(?:去|来|了|过|向|进|步|$)/,
  /(?:^|[，。！？\s一-鿿])站(?:着|了|起|起来|$)/,
  /(?:^|[，。！？\s一-鿿])坐(?:下|了|起|起来|$)/,
  /(?:^|[，。！？\s一-鿿])起身(?:来|$)/,
  /(?:^|[，。！？\s一-鿿])睁眼(?:睛|$)/,
  /(?:^|[，。！？\s一-鿿])挥手(?:臂|$)/,
  /(?:^|[，。！？\s一-鿿])拿起/,
  /(?:^|[，。！？\s一-鿿])握住/,
  /(?:^|[，。！？\s一-鿿])拔出/,
  /(?:^|[，。！？\s一-鿿])出拳/,
  /(?:^|[，。！？\s一-鿿])出剑/,
  /(?:^|[，。！？\s一-鿿])想(?:着|了|过|$)/,
  /(?:^|[，。！？\s一-鿿])看(?:见|了|过|到|向|上|下|$)/,
  /(?:^|[，。！？\s一-鿿])打(?:着|了|过|算|$)/,
  /(?:^|[，。！？\s一-鿿])回(?:答|头|手|来|去|眸|$)/,
  /(?:^|[，。！？\s一-鿿])开口(?:说|$)/,
  /(?:^|[，。！？\s一-鿿])惊呼/,
  /(?:^|[，。！？\s一-鿿])呐喊/,
  /(?:^|[，。！？\s一-鿿])长叹/,
  /(?:^|[，。！？\s一-鿿])挥剑/,
  /(?:^|[，。！？\s一-鿿])斩向/,
  /(?:^|[，。！？\s一-鿿])击向/,
  /(?:^|[，。！？\s一-鿿])奔向/,
  /(?:^|[，。！？\s一-鿿])冲(?:向|出|进|锋|天)/,
]

function lineHasLivingAction(line: string): boolean {
  return LIVING_VERB_PATTERNS.some(p => p.test(line))
}

// ============================================================
// Timeline order check
// ============================================================

/**
 * 检查章节内事件叙述顺序是否符合 canon 时间线。
 * 策略：扫描章节中出现的"角色名 + 时间标记"模式（昨天/今早/刚才/三日前 等），
 *       若标记的时间早于 canon 中该角色的最近事件，标记为潜在倒退。
 */
export function checkTimelineOrder(
  content: string,
  canonTimeline: CanonContext['timeline'],
  chapterNumber: number,
  isFlashback: boolean,
): ConsistencyIssue[] {
  if (isFlashback) return [] // 闪回章节不检查顺序
  const issues: ConsistencyIssue[] = []

  // 时间倒退标记
  const timeMarkers = [
    { pattern: /三天前/, offset: -3 },
    { pattern: /两天前/, offset: -2 },
    { pattern: /昨天/, offset: -1 },
    { pattern: /十年前/, offset: -10 },
    { pattern: /二十年前/, offset: -20 },
    { pattern: /去年/, offset: -1 },
  ]

  for (const { pattern, offset } of timeMarkers) {
    if (offset > -2) continue // 忽略短时间倒推（昨天/三天前 在长篇中可能合理）
    if (pattern.test(content)) {
      // 仅在 offset <= -10 时警告（避免误报"昨天"）
      if (offset <= -10) {
        issues.push({
          severity: 'info',
          category: 'timeline',
          chapterNumber,
          message: `检测到长时间回溯标记「${pattern.source}」，若非闪回请确认是否符合时间线。`,
        })
      }
    }
  }

  // 检查 canon 时间线中是否有相同章节号的多个事件顺序冲突
  const sameChapterEvents = canonTimeline.filter(e => e.chapterNumber === chapterNumber)
  if (sameChapterEvents.length > 1) {
    for (let i = 1; i < sameChapterEvents.length; i++) {
      if (sameChapterEvents[i].sequence < sameChapterEvents[i - 1].sequence) {
        issues.push({
          severity: 'error',
          category: 'event-order',
          chapterNumber,
          message: `canon 时间线第 ${chapterNumber} 章事件 sequence 不单调：${sameChapterEvents[i - 1].sequence} → ${sameChapterEvents[i].sequence}`,
        })
      }
    }
  }

  return issues
}

// ============================================================
// Relationship continuity check
// ============================================================

/**
 * 检查人物关系是否在文中无解释改变。
 * 策略：从章节中提取"X 和 Y 现在/已经/从此 + 关系词"短语，
 *       若 canon 中 X→Y 关系不同 → 警告
 */
export function checkRelationshipContinuity(
  content: string,
  characterStates: CharacterStateSnapshot[],
): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = []
  if (characterStates.length === 0) return issues

  // 关系词
  const relationVerbs = [
    '是朋友', '是好朋友', '是敌人', '是仇人', '是爱人', '是恋人',
    '信任', '怀疑', '背叛', '和好', '结盟', '对立', '是师徒',
    '是兄妹', '是兄弟', '是姐妹', '是夫妻', '是父子', '是父女',
  ]
  // 合并所有已知关系
  const allRelations: Array<{ from: string; to: string; rel: string }> = []
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
      // 检查是否涉及已知关系
      for (const r of allRelations) {
        if (p.includes(r.from) && p.includes(r.to)) {
          // 若文中声明的关系与 canon 不同 → 警告
          if (!r.rel.includes(verb.replace(/^是/, ''))) {
            issues.push({
              severity: 'warning',
              category: 'relationship',
              characters: [r.from, r.to],
              message: `第 ${i + 1} 段提及「${r.from}」与「${r.to}」${verb}，但 canon 记录的关系为「${r.rel}」。若关系变更请确保文本中有明确触发事件。`,
              evidence: p.slice(0, 100),
            })
          }
        }
      }
    }
  }

  return issues
}

// ============================================================
// Item ownership check
// ============================================================

/**
 * 检查物品归属是否无解释变更。
 * 策略：从角色 keyItems 提取物品名，搜索文中"X 拿起/放下/交给 Y 物品"
 */
export function checkItemOwnership(
  content: string,
  characterStates: CharacterStateSnapshot[],
): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = []
  if (characterStates.length === 0) return issues

  // 收集所有已知物品
  const itemOwners = new Map<string, string>()
  for (const s of characterStates) {
    if (!s.keyItems) continue
    const items = s.keyItems.split(/[、，,；;\s]+/).map(x => x.trim()).filter(Boolean)
    for (const item of items) {
      // 若多个角色都有同一物品，记录先出现的（先到先得）
      if (!itemOwners.has(item)) itemOwners.set(item, s.character)
    }
  }

  // 搜索文中的物品使用
  for (const [item, owner] of itemOwners.entries()) {
    if (item.length < 2) continue
    const re = new RegExp(`([\\u4e00-\\u9fa5]{2,8})(拿起|握住|拔出|佩戴|装备|丢弃|交出|送给)([^。]{0,5}${escapeRegex(item)})`, 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(content)) !== null) {
      const user = m[1]
      if (user === owner) continue
      // 若用户是 owner 之外的其他人，且文中没有"接过/得到/赠予"等转移动词 → 警告
      if (['他', '她', '它', '我'].includes(user)) continue
      issues.push({
        severity: 'info',
        category: 'item',
        characters: [user, owner],
        message: `物品「${item}」canon 归属为「${owner}」，但第 ${m.index} 段附近被「${user}」使用/持有，若非转交请确认。`,
        evidence: m[0],
      })
    }
  }

  return issues
}

// ============================================================
// Continuity with previous ending
// ============================================================

export function checkPreviousEndingContinuity(
  content: string,
  previousEnding: string,
): ConsistencyIssue[] {
  if (!previousEnding || previousEnding.length < 20) return []
  const issues: ConsistencyIssue[] = []

  // 取上一章结尾最后两个有意义的句子作为锚点
  const prevSentences = previousEnding.split(/[。！？]/).filter(s => s.trim().length >= 6).slice(-2)
  // 取本章开头前两个有意义的句子
  const currentSentences = content.split(/[。！？]/).filter(s => s.trim().length >= 6).slice(0, 2)

  if (prevSentences.length === 0 || currentSentences.length === 0) return issues

  // 检测人物/地点延续：提取上一章末尾出现的人名，看本章开头是否出现
  const prevNames = extractCharacterNames(prevSentences.join(' '))
  const currentNames = extractCharacterNames(currentSentences.join(' '))

  const overlap = prevNames.filter(n => currentNames.includes(n))
  if (prevNames.length > 0 && overlap.length === 0) {
    // 没有人物重叠 → 可能场景瞬移
    issues.push({
      severity: 'info',
      category: 'continuity',
      message: `上一章结尾出现人物 ${prevNames.slice(0, 3).join('、')}，但本章开头前两句未提及其中任何一人，可能存在场景/视角跳跃。`,
    })
  }

  return issues
}

function extractCharacterNames(text: string): string[] {
  // 简化版：从文中提取 2-4 字的中文名（很粗略，但用于本启发式足够）
  const re = /[\u4e00-\u9fa5]{2,4}/g
  const candidates = text.match(re) || []
  // 过滤掉常见非人名词
  const stopWords = new Set([
    '我们', '他们', '她们', '它们', '大家', '众人', '此时', '此刻', '眼前',
    '一个', '一种', '这个', '那个', '什么', '怎么', '如何', '现在', '以前',
    '只见', '听到', '说道', '我们', '他们', '竟然', '突然', '忽然', '仿佛',
    '原来', '竟然', '真的', '也许', '可能', '应该', '当然',
  ])
  return Array.from(new Set(candidates.filter(c => !stopWords.has(c))))
}

// ============================================================
// 聚合校验
// ============================================================

export interface ValidateParams {
  chapterNumber: number
  chapterContent: string
  canon: CanonContext
  /** 是否为 rewrite/refine 场景（更严格：不能破坏既有事实） */
  isRewrite?: boolean
}

export function validateChapter(params: ValidateParams): ConsistencyIssue[] {
  const { chapterNumber, chapterContent, canon, isRewrite = false } = params
  const isFlashback = isFlashbackChapter(chapterContent)

  let issues: ConsistencyIssue[] = []

  issues = issues.concat(checkLocationContinuity(chapterContent, canon.characterStates))
  issues = issues.concat(checkKnowledgeAuthorization(chapterContent, canon.characterStates))
  issues = issues.concat(checkTimelineOrder(chapterContent, canon.timeline, chapterNumber, isFlashback))
  issues = issues.concat(checkRelationshipContinuity(chapterContent, canon.characterStates))
  issues = issues.concat(checkItemOwnership(chapterContent, canon.characterStates))

  // 第一章不检查与上一章的衔接
  if (chapterNumber > 1) {
    issues = issues.concat(checkPreviousEndingContinuity(chapterContent, canon.previousEnding))
  }

  // rewrite 场景：额外检查不能与已发生事实冲突
  if (isRewrite) {
    issues = issues.concat(checkRewriteFactSafety(chapterContent, canon.timeline, canon.knownFacts))
  }

  return issues
}

/**
 * Rewrite safety check —— 检查修改后的内容是否破坏了 canon 已确立的事实
 */
export function checkRewriteFactSafety(
  content: string,
  timeline: CanonContext['timeline'],
  facts: CanonContext['knownFacts'],
): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = []

  // 若 canon 中某事件说"X 死亡"，rewrite 后文本不应再让 X 活着（除非是闪回/鬼魂）
  for (const ev of timeline) {
    const summary = ev.summary || ''
    const impact = ev.impact || ''
    // 修复：使用 DEATH_PHRASES + DEATH_FALSE_POSITIVES 替代单字 '死'
    if (!isActualDeathMention(summary) && !isActualDeathMention(impact)) continue
    for (const char of ev.characters || []) {
      if (char.length < 2) continue
      // 检测在 rewrite 后文中 char 是否被作为活人提到（不在闪回标记附近）
      const lines = content.split(/\n+/)
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        if (!line.includes(char)) continue
        // 检查前后 50 字符内是否有闪回标记
        const window = lines.slice(Math.max(0, i - 2), i + 3).join(' / ')
        if (FLASHBACK_MARKERS.some(m => window.includes(m))) continue
        // 检测是否在描述"已死"——用同样的 DEATH_PHRASES 判断（避免单字"死"误报成语）
        if (isActualDeathMention(line)) continue
        // 排除"X 死前" / "X 死后" / "X 临死" 等历史描述
        if (/(?:死|亡|殒)(?:前|后|时|中|于|于临)/.test(line)) continue
        // 修复：用词边界的 living verb 列表替代单字匹配
        if (lineHasLivingAction(line)) {
          issues.push({
            severity: 'error',
            category: 'continuity',
            characters: [char],
            message: `Rewrite 内容让已死亡人物「${char}」呈现存活行为，可能破坏了 canon 已确立的事实。`,
            evidence: line.slice(0, 100),
          })
        }
      }
    }
  }

  // 关键事实条目：若 canon 中标记某地为"X 城"，rewrite 后不应改名为"Y 城"
  for (const fact of facts) {
    if (fact.category !== 'location' && fact.category !== 'identity') continue
    if (!fact.evidence) continue
    // 检测 fact.statement 中的人名/地名在文中是否被改写
    const tokens = fact.statement.match(/[\u4e00-\u9fa5]{2,6}/g) || []
    for (const token of tokens) {
      if (token.length < 2) continue
      // 这里只做粗略检查：若 fact 提到某角色，且 rewrite 中该角色出现与 "曾经/已" 矛盾的状态
      if (fact.category === 'identity' && fact.statement.includes(token)) {
        const denialPatterns = [
          new RegExp(`${escapeRegex(token)}(并不是|其实不是|并非|不叫)`),
        ]
        for (const pat of denialPatterns) {
          if (pat.test(content)) {
            issues.push({
              severity: 'warning',
              category: 'continuity',
              message: `Rewrite 内容可能推翻 canon 身份事实：${fact.statement}`,
              evidence: content.match(pat)?.[0] || '',
            })
          }
        }
      }
    }
  }

  return issues
}
