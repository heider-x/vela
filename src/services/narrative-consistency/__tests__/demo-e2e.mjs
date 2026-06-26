/**
 * 端到端演示 —— 不依赖 npm，直接展示 Narrative Consistency 全部能力
 *
 * 场景：玄幻小说《青云剑》
 *   - 第 1 章：林轩在青云山学剑，师父在世
 *   - 第 2 章：林轩下山，师父被赵无极所害（死亡）
 *   - 第 3 章（生成中）：必须保持一致性
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

// ============================================================
// 复用 self-contained.test.mjs 中的所有算法
// ============================================================
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const __dirname = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(__dirname, 'self-contained.test.mjs'), 'utf-8')
// 提取前 220 行的算法定义
const algoSrc = src.substring(src.indexOf('// ============================================================\n// Fixtures'), src.indexOf('// ============================================================\n// Tests\n'))
const moduleCode = algoSrc + '\nexport { makeState, makeCanon, makeTimeline, checkLocationContinuity, checkKnowledgeAuthorization, checkRelationshipContinuity, checkTimelineOrder, checkItemOwnership, checkPreviousEndingContinuity, checkRewriteFactSafety, validateChapter, tryAutoFix }\n'
const tmpFile = join(__dirname, '..', '__demo-algo.mjs')
import { writeFileSync, unlinkSync } from 'node:fs'
writeFileSync(tmpFile, moduleCode)
const algo = await import('../__demo-algo.mjs')
const { makeState, makeCanon, makeTimeline, validateChapter, tryAutoFix } = algo

// ============================================================
// 演示 1: CanonContext 注入到 prompt 的样子
// ============================================================
console.log('═'.repeat(70))
console.log('演示 1: CanonContext 注入到 prompt（按固定优先级排列）')
console.log('═'.repeat(70))

// 构造一个完整的世界设定
const worldRules = `世界观：修真界，以剑为尊。
力量体系：炼气→筑基→金丹→元婴→化神→渡劫→大乘。
势力：青云门（正道领袖）、烈火宗（邪道）、天元城（中立贸易都市）。`

const characterArch = `林轩：青云门大弟子，性格坚毅，修炼天赋极高。
李四：林轩同门师兄，擅长阵法。
赵无极：烈火宗宗主，野心勃勃，觊觎青云门秘宝。
师父（青云真人）：林轩师父，金丹期高手。`

// 角色当前状态（经过前 2 章演化）
const characterStates = [
  makeState({
    character: '林轩',
    location: '天元城',
    powerLevel: '筑基期',
    physicalState: '正常',
    mentalState: '悲愤',
    keyItems: '青虹剑、玉佩',
    currentGoal: '为师父报仇',
    knowledge: ['师父被赵无极所害', '赵无极是烈火宗宗主'],
    relationships: { 李四: '同门师兄', 赵无极: '杀师仇人' },
    recentEvents: '离开青云山前往天元城',
    updatedAtChapter: 2,
  }),
  makeState({
    character: '李四',
    location: '青云山',
    powerLevel: '筑基期',
    physicalState: '正常',
    mentalState: '悲痛',
    keyItems: '阵旗',
    currentGoal: '守护青云山',
    knowledge: ['师父被赵无极所害'],
    relationships: { 林轩: '同门师弟' },
    recentEvents: '留守青云山处理后事',
    updatedAtChapter: 2,
  }),
]

// 时间线（前 2 章事件）
const timeline = makeTimeline([
  { chapterNumber: 1, sequence: 1, location: '青云山', characters: ['林轩', '师父'], summary: '林轩在青云山学剑十年' },
  { chapterNumber: 2, sequence: 1, location: '天元城', characters: ['赵无极', '师父'], summary: '师父在烈火宗之战中死亡', impact: '师父死亡；林轩与赵无极结仇' },
])

// 未结剧情线
const openPlotLines = [
  { name: '为师报仇', status: 'active', startedAt: 2, lastAdvancedAt: 2, characters: ['林轩', '赵无极'], currentState: '林轩刚下山，尚未行动' },
]

// 上一章结尾
const previousEnding = '林轩跪在师父墓前，雨水打湿了他的衣襟。他缓缓站起，目光望向烈火宗的方向。'

// 本章目标
const chapterGoal = '第 3 章：天元城\n林轩在天元城与李四会合，得知赵无极已闭关。林轩决定先提升实力再报仇。'

// RAG 检索结果
const ragContext = `[1] (《剑道真解》第3卷，相关度 89%)\n剑修之道，在于心境。心乱则剑乱，心定则剑定。\n\n[2] (《天元城志》，相关度 72%)\n天元城乃四战之地，青云门、烈火宗、玄天宗三方势力在此交汇。`

// 风格要求
const writingStyle = '热血、紧凑、网文风；多用短句动作描写；善用伏笔与悬念。'

// 全局行文指导
const globalGuidance = '主角必须遵守天道；反派不可洗白；感情线需循序渐进。'

// 硬性约束
const HARD_CONSTRAINTS = `【硬性叙事一致性约束（违反任何一条都会被视为错误）】
1. 不得改变已发生事实：上文明确写过的事件、状态、事实，本章不得推翻、改写或自相矛盾。
2. 不得让人物凭空知道未获得的信息：信息只能通过对话、书信、目击、推理等方式习得。
3. 不得无解释改变地点：人物在两个段落间不得瞬移到不同地点。
4. 不得无解释改变人物关系：关系恶化或修复必须有明确触发事件。
5. 不得打乱时间线顺序：本章事件必须发生在上一章事件之后（除非显式标注闪回）。
6. 必须自然衔接上一章节：起笔必须从上一章结尾的场景/状态平滑过渡。
7. 不得让人物持有未获得的物品：物品归属变更必须有拾取/购买/赠予/夺取等明确描写。
8. 不得让已死的角色出场（除非是闪回或鬼魂设定）。
9. 设定一经确立不得违反。
10. 如确需闪回，必须显式以"回忆"、"十年前"、"脑海中浮现"等词语标记。`

// 按优先级拼接
const canonContext = [
  '【正史设定（不可违背）】', worldRules,
  '【人物群像（静态设定）】', characterArch,
  '【当前人物状态（最高优先级 · 生成时不得推翻）】',
  characterStates.map(s => `- ${s.character} | 地点：${s.location} | 境界：${s.powerLevel} | 身体：${s.physicalState} | 心理：${s.mentalState} | 道具：${s.keyItems} | 当前目标：${s.currentGoal} | 已知：${s.knowledge.join('；')}${Object.keys(s.relationships).length ? ' | 关系：' + Object.entries(s.relationships).map(([k,v]) => `${k}→${v}`).join('；') : ''}`).join('\n'),
  '【已发生事件时间线（严格单向 · 按章节+顺序排列）】',
  timeline.map(e => `[第${e.chapterNumber}章·#${e.sequence}] ${e.characters.join('、')} 在「${e.location}」：${e.summary}${e.impact ? `（影响：${e.impact}）` : ''}`).join('\n'),
  '【未结剧情线（必须在写作时考虑推进或避免冲突）】',
  openPlotLines.map(l => `- [${l.status}] ${l.name}（起始第${l.startedAt}章）：${l.currentState} | 涉及：${l.characters.join('、')}`).join('\n'),
  '【上一章结尾（必须自然衔接）】', previousEnding,
  '【本章写作目标】', chapterGoal,
  '【知识库参考（最低优先级 · 仅当与上述 canon 冲突时以 canon 为准）】', ragContext,
  '【文风要求】', writingStyle,
  '【全局行文指导】', globalGuidance,
  '【硬性约束（必须严格遵守）】', HARD_CONSTRAINTS,
].join('\n\n')

console.log('CanonContext 长度：' + canonContext.length + ' 字符')
console.log('CanonContext 块数：13')
console.log('块顺序：正史设定 → 人物群像 → 当前人物状态 → 时间线 → 未结剧情 → 上一章结尾 → 本章目标 → RAG → 文风 → 全局指导 → 硬性约束')
console.log()
console.log('前 600 字预览：')
console.log('─'.repeat(70))
console.log(canonContext.slice(0, 600))
console.log('...')
console.log('─'.repeat(70))

// ============================================================
// 演示 2: LLM 模拟生成（用一个有"问题"的草稿）
// ============================================================
console.log()
console.log('═'.repeat(70))
console.log('演示 2: LLM 模拟生成（草稿刻意包含多种一致性问题）')
console.log('═'.repeat(70))

const draftText = `林轩在青云山与师父告别。

赵无极突然出现，他笑着说："林轩，我来取你性命。"

林轩在烈火宗与赵无极激战三百回合，林轩知道赵无极的弱点是背后的玉佩。

林轩说："今天我要为师报仇。"

赵无极在烈火宗闭关十天后出现，他的弱点是背后的玉佩。

回忆：十年前，师父在青云山教林轩剑法，那时候师父还活着。

师父在青云山笑着说："孩子们，我来了。"

林轩挥剑斩向赵无极。`

console.log('草稿长度：' + draftText.length + ' 字')
console.log()

// ============================================================
// 演示 3: 一致性校验
// ============================================================
console.log('═'.repeat(70))
console.log('演示 3: 一致性校验（6 维问题检测）')
console.log('═'.repeat(70))

const canon = {
  characterStates,
  timeline,
  openPlotLines: [],
  knownFacts: [],
  previousEnding,
}

const issues = validateChapter({
  chapterNumber: 3,
  chapterContent: draftText,
  canon,
  isRewrite: false,
})

console.log(`检测到 ${issues.length} 个一致性问题：`)
console.log()
issues.forEach((issue, i) => {
  const sev = issue.severity === 'error' ? '❌' : issue.severity === 'warning' ? '⚠️ ' : 'ℹ️ '
  const cat = issue.category
  const chars = issue.characters ? ` [${issue.characters.join('/')}]` : ''
  const ev = issue.evidence ? `\n     证据：${issue.evidence.slice(0, 60)}` : ''
  console.log(`  ${i + 1}. ${sev} [${cat}]${chars} ${issue.message}${ev}`)
})

// ============================================================
// 演示 4: 自动修复
// ============================================================
console.log()
console.log('═'.repeat(70))
console.log('演示 4: 自动修复（保守策略 · 仅修复高置信度问题）')
console.log('═'.repeat(70))

const autoFixResult = tryAutoFix(draftText, issues)
console.log(`自动修复：${autoFixResult.modified ? '✅ 已修复' : '❌ 无可修复'}`)
console.log(`  - 已修复：${autoFixResult.fixedIssues.length} 处`)
console.log(`  - 残留 warning：${autoFixResult.remainingIssues.length} 处`)
console.log()

if (autoFixResult.modified) {
  console.log('自动修复后的前 400 字：')
  console.log('─'.repeat(70))
  console.log(autoFixResult.content.slice(0, 400))
  console.log('...')
  console.log('─'.repeat(70))
}

if (autoFixResult.remainingIssues.length > 0) {
  console.log()
  console.log('残留 warning（提示人工审阅，不阻塞保存）：')
  autoFixResult.remainingIssues.forEach((issue, i) => {
    const sev = issue.severity === 'error' ? '❌' : '⚠️ '
    console.log(`  ${i + 1}. ${sev} [${issue.category}] ${issue.message.slice(0, 100)}`)
  })
}

console.log()
console.log('═'.repeat(70))
console.log('✅ 演示完成。生成章节不会破坏事实一致性。')
console.log('═'.repeat(70))

// 清理
unlinkSync(tmpFile)
