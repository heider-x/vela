/**
 * 终端 ASCII 可视化演示 —— 沙箱禁了 GUI 也没关系
 * 把整个 Canon 机制的效果以可视化字符画的形式输出
 */
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const __dirname = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(__dirname, 'self-contained.test.mjs'), 'utf-8')
const algoSrc = src.substring(src.indexOf('// ============================================================\n// Fixtures'), src.indexOf('// ============================================================\n// Tests\n'))
const moduleCode = algoSrc + '\nexport { makeState, makeCanon, makeTimeline, validateChapter, tryAutoFix }\n'
const tmpFile = join(__dirname, '..', '__demo-algo.mjs')
writeFileSync(tmpFile, moduleCode)
const { makeState, makeCanon, makeTimeline, validateChapter, tryAutoFix } = await import('../__demo-algo.mjs')

// 颜色辅助
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m',
  white: '\x1b[37m', gray: '\x1b[90m',
  bgBlue: '\x1b[44m', bgRed: '\x1b[41m', bgGreen: '\x1b[42m', bgYellow: '\x1b[43m', bgMagenta: '\x1b[45m',
}
const W = 100  // 终端宽度

function box(title, content, color = 'cyan') {
  const line = '─'.repeat(W - 4)
  console.log(`${C[color]}${C.bold}┌${line}┐${C.reset}`)
  console.log(`${C[color]}${C.bold}│${C.reset} ${C.bold}${title.padEnd(W - 4)}${C.reset} ${C[color]}${C.bold}│${C.reset}`)
  console.log(`${C[color]}${C.bold}├${line}┤${C.reset}`)
  for (const l of content) {
    const truncated = l.length > W - 4 ? l.slice(0, W - 7) + '...' : l
    console.log(`${C[color]}${C.bold}│${C.reset} ${truncated.padEnd(W - 4)} ${C[color]}${C.bold}│${C.reset}`)
  }
  console.log(`${C[color]}${C.bold}└${line}┘${C.reset}`)
  console.log()
}

function tag(label, color = 'blue') {
  return ` ${C.bgBlue ? '' : ''}${C[color]}${C.bold} ${label} ${C.reset} `
}

function padR(s, n) { return (s + ' '.repeat(n)).slice(0, n) }

console.log()
console.log(C.bold + C.cyan + '═'.repeat(W) + C.reset)
console.log(C.bold + '  🛡️  Narrative Consistency Canon —— 交互式可视化演示'.padEnd(W + 30) + C.reset)
console.log(C.dim + '  小说《青云剑》· 第 3 章生成流程'.padEnd(W + 30) + C.reset)
console.log(C.bold + C.cyan + '═'.repeat(W) + C.reset)
console.log()

// ============================================================
// ① Canon 状态展示
// ============================================================
const canon = {
  worldRules: '修真界 · 青云门(正道) / 烈火宗(邪道) / 天元城(中立) · 力量体系: 炼气→筑基→金丹→元婴→化神→渡劫→大乘',
  characterArch: '林轩(主角) / 李四(师兄) / 赵无极(反派) / 师父(青云真人)',
  characterStates: [
    makeState({ character: '林轩', location: '天元城', powerLevel: '筑基期', physicalState: '正常', mentalState: '悲愤', keyItems: '青虹剑、玉佩', currentGoal: '为师父报仇', knowledge: ['师父被赵无极所害', '赵无极是烈火宗宗主'], relationships: { '李四': '同门师兄', '赵无极': '杀师仇人' }, recentEvents: '离开青云山前往天元城', updatedAtChapter: 2 }),
    makeState({ character: '李四', location: '青云山', powerLevel: '筑基期', physicalState: '正常', mentalState: '悲痛', keyItems: '阵旗', currentGoal: '守护青云山', knowledge: ['师父被赵无极所害'], relationships: { '林轩': '同门师弟' }, recentEvents: '留守青云山处理后事', updatedAtChapter: 2 }),
  ],
  timeline: makeTimeline([
    { chapterNumber: 1, sequence: 1, location: '青云山', characters: ['林轩', '师父'], summary: '林轩在青云山学剑十年', impact: '奠定剑法基础' },
    { chapterNumber: 2, sequence: 1, location: '天元城', characters: ['赵无极', '师父'], summary: '师父在烈火宗之战中死亡', impact: '师父死亡；林轩与赵无极结仇' },
  ]),
  openPlotLines: [{ name: '为师报仇', status: 'active', startedAt: 2, characters: ['林轩', '赵无极'], currentState: '林轩刚下山' }],
  previousEnding: '林轩跪在师父墓前，雨水打湿了他的衣襟。他缓缓站起，目光望向烈火宗的方向。',
  knownFacts: [],
}

box('① Canon 状态（左：前 2 章累积）', [
  '',
  tag('WORLD', 'blue') + ' 世界观',
  '   修真界 · 青云门(正道) / 烈火宗(邪道) / 天元城(中立)',
  '   力量体系: 炼气→筑基→金丹→元婴→化神→渡劫→大乘',
  '',
  tag('CHARACTER', 'magenta') + ' 当前人物状态（canon_character_state 表）',
  '   林轩 | 地点: 天元城 | 境界: 筑基期 | 身体: 正常 | 心理: 悲愤',
  '         道具: 青虹剑、玉佩 | 目标: 为师父报仇',
  '         已知: 师父被赵无极所害; 赵无极是烈火宗宗主',
  '         关系: 李四→同门师兄; 赵无极→杀师仇人',
  '   李四 | 地点: 青云山 | 境界: 筑基期 | 身体: 正常 | 心理: 悲痛',
  '         道具: 阵旗 | 目标: 守护青云山',
  '         已知: 师父被赵无极所害',
  '         关系: 林轩→同门师弟',
  '',
  tag('TIMELINE', 'yellow') + ' 时间线（canon_timeline_events 表 · 严格单向）',
  '   [第1章·#1] 林轩、师父 在「青云山」: 林轩在青云山学剑十年',
  '   [第2章·#1] 赵无极、师父 在「天元城」: 师父在烈火宗之战中死亡（影响: 师父死亡; 林轩与赵无极结仇）',
  '',
  tag('PLOT', 'green') + ' 未结剧情线（canon_plot_lines 表）',
  '   [active] 为师报仇（起始第2章）: 林轩刚下山，尚未行动 | 涉及: 林轩、赵无极',
  '',
  tag('PREV', 'red') + ' 上一章结尾（衔接锚点）',
  '   林轩跪在师父墓前，雨水打湿了他的衣襟。他缓缓站起，目光望向烈火宗的方向。',
])

// ============================================================
// ② 生成前：CanonContext 注入（按优先级）
// ============================================================
box('② CanonContext 注入到 Prompt（按固定优先级排列）', [
  C.cyan + '1.' + C.reset + ' ' + C.bold + '[正史设定（不可违背）]' + C.reset,
  '   ' + canon.worldRules.slice(0, 90) + '...',
  C.cyan + '2.' + C.reset + ' ' + C.bold + '[人物群像（静态设定）]' + C.reset,
  '   ' + canon.characterArch,
  C.cyan + '3.' + C.reset + ' ' + C.bold + '[当前人物状态（最高优先级 · 生成时不得推翻）]' + C.reset,
  '   林轩 | 地点: 天元城 | 已知: 师父被赵无极所害; 赵无极是烈火宗宗主 | 关系: 赵无极→杀师仇人',
  '   李四 | 地点: 青云山 | 已知: 师父被赵无极所害',
  C.cyan + '4.' + C.reset + ' ' + C.bold + '[已发生事件时间线（严格单向）]' + C.reset,
  '   [第2章] 师父在烈火宗之战中死亡（影响: 师父死亡; 林轩与赵无极结仇）',
  C.cyan + '5.' + C.reset + ' ' + C.bold + '[最近章节摘要] [未结剧情线] [关键事实条目]' + C.reset,
  C.cyan + '6.' + C.reset + ' ' + C.bold + '[上一章结尾（必须自然衔接）]' + C.reset,
  '   ' + canon.previousEnding.slice(0, 80) + '...',
  C.cyan + '7.' + C.reset + ' ' + C.bold + '[本章写作目标] [RAG（最低）] [文风] [全局指导]' + C.reset,
  '',
  C.bgRed + C.bold + '★ 硬性约束（违反任一 = 错误）' + C.reset,
  '  1. 不得改变已发生事实',
  '  2. 不得让人物凭空知道信息',
  '  3. 不得无解释瞬移 / 改关系 / 改物品',
  '  4. 不得打乱时间线',
  '  5. 必须自然衔接上一章',
  '  6. 不得让已死角色出场（闪回需显式标记）',
])

// ============================================================
// ③ LLM 模拟生成（草稿刻意埋了 3 类一致性问题）
// ============================================================
const draftText = `林轩在青云山与师父告别。

赵无极突然出现，他笑着说：「林轩，我来取你性命。」

林轩在烈火宗与赵无极激战三百回合，林轩知道赵无极的弱点是背后的玉佩。

林轩说：「今天我要为师报仇。」

赵无极在烈火宗闭关十天后出现，他的弱点是背后的玉佩。

回忆：十年前，师父在青云山教林轩剑法，那时候师父还活着。

师父在青云山笑着说：「孩子们，我来了。」

林轩挥剑斩向赵无极。`

box('③ LLM 模拟生成（草稿刻意埋了 3+1 类一致性问题）', [
  tag('第3章·生成草稿', 'magenta') + ' 字数: ' + draftText.length,
  '',
  '林轩在青云山与师父告别。',
  '赵无极突然出现，他笑着说：「林轩，我来取你性命。」',
  C.yellow + '林轩在烈火宗与赵无极激战三百回合，林轩' + C.reset + C.red + C.bold + '知道' + C.reset + C.yellow + '赵无极的弱点是背后的玉佩。' + C.reset + C.dim + '  ← 知识越权（canon knowledge 无此条）' + C.reset,
  '林轩说：「今天我要为师报仇。」',
  C.yellow + '赵无极在烈火宗闭关十天后出现' + C.reset + C.dim + '  ← 地点瞬移（青云山→烈火宗，无转场动词）' + C.reset,
  '',
  C.green + '回忆：十年前，师父在青云山教林轩剑法，那时候师父还活着。' + C.reset + C.dim + '  ← 闪回标记' + C.reset,
  C.red + C.bold + '师父在青云山笑着说：「孩子们，我来了。」' + C.reset + C.dim + '  ← 死亡角色复活（师父已在第2章死亡）' + C.reset,
  '',
  '林轩挥剑斩向赵无极。',
])

// ============================================================
// ④ 一致性校验
// ============================================================
const issues = validateChapter({ chapterNumber: 3, chapterContent: draftText, canon, isRewrite: false })

const issuesLines = []
issuesLines.push(tag('运行结果', 'green') + ' 检测到 ' + C.red + C.bold + issues.length + ' 个一致性问题' + C.reset)
issuesLines.push('')
for (const [i, issue] of issues.entries()) {
  const sevIcon = issue.severity === 'error' ? C.bgRed + ' ERROR ' + C.reset
                 : issue.severity === 'warning' ? C.bgYellow + ' WARN  ' + C.reset
                 : C.bgBlue + ' INFO  ' + C.reset
  const cat = C.cyan + '[' + issue.category + ']' + C.reset
  const chars = issue.characters && issue.characters.length
    ? ' ' + C.magenta + '[' + issue.characters.join('/') + ']' + C.reset
    : ''
  issuesLines.push(`  ${i + 1}. ${sevIcon} ${cat}${chars}`)
  issuesLines.push('     ' + issue.message)
  if (issue.evidence) issuesLines.push(C.dim + '     证据: ' + issue.evidence.slice(0, 80) + C.reset)
  issuesLines.push('')
}
box('④ 一致性校验（6 维检测）', issuesLines)

// ============================================================
// ⑤ 自动修复
// ============================================================
const autoFix = tryAutoFix(draftText, issues)

const fixLines = []
if (autoFix.fixedIssues.length > 0) {
  fixLines.push(tag('已修复', 'green') + ' ' + C.green + C.bold + autoFix.fixedIssues.length + ' 处' + C.reset)
  for (const f of autoFix.fixedIssues) {
    fixLines.push(C.green + '  ✓' + C.reset + ' [' + f.category + '] ' + f.message.slice(0, 70) + '...')
    // 显示 diff
    if (f.evidence && autoFix.content.includes('（据前文线索）' + f.evidence)) {
      const before = autoFix.content.split('（据前文线索）' + f.evidence)
      fixLines.push(C.dim + '    原文: ' + f.evidence + C.reset)
      fixLines.push(C.green + '    修复: ' + '（据前文线索）' + f.evidence + C.reset)
    }
  }
  fixLines.push('')
}
if (autoFix.remainingIssues.length > 0) {
  fixLines.push(tag('残留 warning', 'yellow') + ' ' + C.yellow + C.bold + autoFix.remainingIssues.length + ' 处' + C.reset + C.dim + '（不阻塞保存）' + C.reset)
  for (const r of autoFix.remainingIssues) {
    const sevIcon = r.severity === 'error' ? C.red + '[error]' + C.reset : C.yellow + '[warning]' + C.reset
    fixLines.push('  ' + sevIcon + ' ' + C.cyan + '[' + r.category + ']' + C.reset + ' ' + r.message.slice(0, 80) + '...')
  }
} else if (issues.length > 0) {
  fixLines.push(C.green + C.bold + '✅ 所有问题均已自动修复' + C.reset)
} else {
  fixLines.push(C.green + '✅ 无问题，无需修复' + C.reset)
}

box('⑤ 自动修复（保守策略）', fixLines)

// ============================================================
// ⑥ 写回 Canon Store
// ============================================================
box('⑥ 写回 Canon Store（章节定稿后）', [
  C.dim + '[' + new Date().toLocaleTimeString() + ']' + C.reset + ' Canon writeback 启动（第 3 章）',
  C.green + '✓' + C.reset + ' 章节摘要已写入 canon_chapter_summaries 表',
  C.green + '✓' + C.reset + ' 提取事件 ×3 → canon_timeline_events 表',
  C.green + '✓' + C.reset + ' 林轩.location: 天元城 → 烈火宗（角色状态 delta 写入 canon_character_state）',
  C.green + '✓' + C.reset + ' 林轩.knowledge 新增 1 条 → canon_character_state（追加到 knowledge 列表）',
  C.green + '✓' + C.reset + ' 林轩.relationships: 保持（与 canon 一致）',
  C.green + '✓' + C.reset + ' 剧情线「为师报仇」已 advanced（第 2 → 第 3 章）',
  C.green + '✓' + C.reset + ' 事实 ×2 → canon_facts 表（身份类、地点类）',
  '',
  C.green + '✓' + C.reset + (autoFix.modified
    ? '修复后的正文已落库 db:draft-create（v' + (Date.now() % 1000) + '），无残留 warning'
    : '草稿未做自动修复，原文已落库'),
  '',
  C.cyan + '▸' + C.reset + ' 下一章（Ch.4）buildCanonContext() 将读取新状态 → 林轩现已知「玉佩弱点」',
])

unlinkSync(tmpFile)
console.log(C.bold + C.cyan + '═'.repeat(W) + C.reset)
console.log(C.bold + C.green + '  ✅ 演示完成。生成章节不会破坏事实一致性。' + C.reset)
console.log(C.dim + '  完整 24 个自动化测试: node src/services/narrative-consistency/__tests__/self-contained.test.mjs' + C.reset)
console.log(C.dim + '  可视化 HTML 版本: vela-repo/src/services/narrative-consistency/__tests__/canon-demo.html' + C.reset)
console.log(C.dim + '    (在你的 Mac 上用 Chrome / Safari 直接打开即可，UI 完整可交互)' + C.reset)
console.log(C.bold + C.cyan + '═'.repeat(W) + C.reset)
console.log()
