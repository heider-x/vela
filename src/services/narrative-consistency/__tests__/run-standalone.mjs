#!/usr/bin/env node
/**
 * 独立测试运行器 —— 不需要任何 npm 依赖
 *
 * 读取 TypeScript 源文件 → 用简单正则剥离类型 → 写入临时 .mjs →
 * 用 Node 的 --test 运行
 *
 * 用法：
 *   node src/services/narrative-consistency/__tests__/run-standalone.mjs
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, basename, extname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const SRC_DIR = join(__dirname, '..')
const TEST_DIR = __dirname

// ============================================================
// 简单的 TypeScript 类型剥离器
// 仅支持本项目使用的语法子集：
//   - interface / type 定义整段删除
//   - 泛型参数 <T> 在 import 后删除
//   - 函数参数与返回值的类型注解删除
//   - as Type / : Type 断言删除
// ============================================================
function stripTypes(src) {
  let out = src
  // 1. 删除多行 interface 声明（包括 export 前缀）
  out = out.replace(/export\s+interface\s+\w+[\s\S]*?\n\}\n/g, '')
  out = out.replace(/^\s*interface\s+\w+[\s\S]*?\n\}\n/gm, '')
  // 2. 删除 type 别名（多行）
  out = out.replace(/export\s+type\s+\w+[\s\S]*?from\s+[^;]+;/g, '')  // export type X = ... import(...)
  out = out.replace(/export\s+type\s+\w+\s*=[\s\S]*?(?=\n\nexport|\n\nconst|\n\nfunction|\n\nclass|\n\n\/\/|\n$)/g, '')
  // 3. 处理 export { type X, Y, type Z } -> 仅保留非 type 标识符
  out = out.replace(/export\s*\{([^}]+)\}/g, (m, inner) => {
    const names = inner.split(',').map(s => s.trim()).filter(Boolean)
      .map(s => s.replace(/^type\s+/, '').trim())
      .filter(s => s && !s.startsWith('type '))
    return names.length > 0 ? `export { ${names.join(', ')} }` : ''
  })
  // 4. 处理 import { type X, Y, type Z } -> 仅保留非 type 标识符
  out = out.replace(/import\s*\{([^}]+)\}\s*from/g, (m, inner) => {
    const names = inner.split(',').map(s => s.trim()).filter(Boolean)
      .map(s => s.replace(/^type\s+/, '').trim())
      .filter(s => s && !s.startsWith('type '))
    return names.length > 0 ? `import { ${names.join(', ')} } from` : ''
  })
  // 5. 删除 import type { ... }
  out = out.replace(/import\s+type\s*\{[^}]*\}\s*from\s+['"][^'"]+['"]\n?/g, '')
  out = out.replace(/import\s+type\s+\w+\s+from\s+['"][^'"]+['"]\n?/g, '')
  // 6. 删除 as 类型断言
  out = out.replace(/\s+as\s+[A-Za-z_<>[\]|& ,]+(?=[,)])/g, '')
  // 7. 删除函数参数的类型注解（: Type）
  out = out.replace(/\):\s*[A-Za-z_<>[\]|& ,.\{\}]+(\s*=>)/g, ') =>')
  out = out.replace(/\)\s*:\s*[A-Za-z_<>[\]|& ,.\{\}]+\s*\{/g, ') {')
  out = out.replace(/\):\s*[A-Za-z_<>[\]|& ,.\{\}]+(\s*\{)/g, ') $1')
  // 8. 删除变量类型注解
  out = out.replace(/^\s*(const|let|var)\s+(\w+)\s*:\s*[A-Za-z_<>[\]|& ,.\{\}\[\]]+(\s*=)/gm, '$1 $2 $3')
  // 8b. 删除函数参数类型注解（: SimpleType = default）—— 仅匹配简单标识符类型
  out = out.replace(/(\w+)\s*:\s*[A-Za-z_][\w<>\[\]\s,]*?(\s*=\s*[^,)]+)/g, '$1$2')
  // 8c. 删除函数参数类型注解（: SimpleType，无默认值）
  out = out.replace(/(\w+)\s*:\s*[A-Za-z_][\w<>\[\]\s,]*?(\s*[,)])/g, '$1$2')
  // 9. 处理泛型参数
  out = out.replace(/<\s*[A-Za-z_,\s\|&\[\]\{\}]+>(?=\s*\()/g, '')
  // 10. 处理 import { xxx } from './yyy' -> 转换 .ts 为 .mjs，或添加 .mjs 扩展名
  out = out.replace(/from\s+['"](\.[^'"]+)['"]/g, (m, p) => {
    if (p.endsWith('.mjs') || p.endsWith('.js')) return m
    if (p.endsWith('.ts')) return `from '${p.replace(/\.ts$/, '.mjs')}'`
    return `from '${p}.mjs'`
  })
  // 11. 删除 export {} 形式
  out = out.replace(/export\s*\{\s*\}/g, '')
  // 12. 删除剩余的 type 标识符（在 export 后跟 type X）
  out = out.replace(/^export\s+type\s+\w+\s*=[\s\S]*?\n(?=\nexport|\nconst|\nfunction|\nclass|\n\/\/)/gm, '')
  return out
}

// ============================================================
// 读取并转译源文件
// ============================================================
const tempDir = mkdtempSync(join(tmpdir(), 'narrative-test-'))
console.log(`[run-standalone] 临时目录: ${tempDir}`)

const sourceFiles = [
  'types.ts',
  'validator.ts',
  'auto-fix.ts',
  'fact-extractor.ts',
  'canon-store.ts',
  'context-builder.ts',
  'index.ts',
]

const writtenFiles = {}
for (const f of sourceFiles) {
  const src = readFileSync(join(SRC_DIR, f), 'utf-8')
  const stripped = stripTypes(src)
  const outPath = join(tempDir, f.replace('.ts', '.mjs'))
  writeFileSync(outPath, stripped)
  writtenFiles[f] = outPath
}

// 直接复制 JS fixtures（已经是纯 JS）
import { copyFileSync } from 'node:fs'
const fixturesPath = join(tempDir, 'fixtures.mjs')
copyFileSync(join(TEST_DIR, 'fixtures.js'), fixturesPath)

// 直接复制 JS 测试主体（已经是纯 JS）
const testPath = join(tempDir, 'standalone.test.mjs')
copyFileSync(join(TEST_DIR, 'standalone.test.js'), testPath)

// 修补 standalone.test.mjs 的 imports 以指向临时目录
let testPatched = readFileSync(testPath, 'utf-8')
testPatched = testPatched.replace(
  /from\s+['"]\.\.\/index\.js['"]/g,
  `from '${pathToFileURL(join(tempDir, 'index.mjs')).href}'`,
)
testPatched = testPatched.replace(
  /from\s+['"]\.\/fixtures\.js['"]/g,
  `from '${pathToFileURL(fixturesPath).href}'`,
)
writeFileSync(testPath, testPatched)

// ============================================================
// 为 canon-store 提供 ipc-client stub
// ============================================================
const ipcStub = `
const __ipcCalls = []
const __ipcStore = {
  timeline: [],
  characterState: new Map(),
  plotLines: [],
  facts: [],
  summaries: new Map(),
}
const ipc = {
  invoke: async (channel, ...args) => {
    __ipcCalls.push({ channel, args })
    if (channel === 'db:canon-timeline-get') return __ipcStore.timeline.filter(e => e.chapterNumber <= args[0])
    if (channel === 'db:canon-timeline-get-chapter') return __ipcStore.timeline.filter(e => e.chapterNumber === args[0])
    if (channel === 'db:canon-timeline-append') { const id = __ipcStore.timeline.length + 1; __ipcStore.timeline.push({ id, ...args[0] }); return { success: true, id } }
    if (channel === 'db:canon-timeline-clear-chapter') { __ipcStore.timeline = __ipcStore.timeline.filter(e => e.chapterNumber !== args[0]); return { success: true } }
    if (channel === 'db:canon-character-state-get-all') return Array.from(__ipcStore.characterState.values())
    if (channel === 'db:canon-character-state-get') return __ipcStore.characterState.get(args[0]) || null
    if (channel === 'db:canon-character-state-upsert') { __ipcStore.characterState.set(args[0].character, args[0]); return { success: true } }
    if (channel === 'db:canon-plot-list') return args[0] ? __ipcStore.plotLines.filter(p => p.status === args[0]) : __ipcStore.plotLines
    if (channel === 'db:canon-plot-add') { const existing = __ipcStore.plotLines.find(p => p.name === args[0].name); if (existing) return { success: true, id: existing.id }; const id = __ipcStore.plotLines.length + 1; __ipcStore.plotLines.push({ id, ...args[0] }); return { success: true, id } }
    if (channel === 'db:canon-plot-advance') { const p = __ipcStore.plotLines.find(x => x.id === args[0]); if (p) { p.currentState = args[1]; p.lastAdvancedAt = args[2]; } return { success: true } }
    if (channel === 'db:canon-plot-resolve') { const p = __ipcStore.plotLines.find(x => x.id === args[0]); if (p) { p.status = 'resolved'; p.resolvedAt = args[1]; p.lastAdvancedAt = args[1]; } return { success: true } }
    if (channel === 'db:canon-fact-list') return __ipcStore.facts
    if (channel === 'db:canon-fact-add') { const existing = __ipcStore.facts.find(f => f.statement === args[0].statement); if (existing) return { success: true, id: existing.id }; const id = __ipcStore.facts.length + 1; __ipcStore.facts.push({ id, ...args[0] }); return { success: true, id } }
    if (channel === 'db:canon-fact-clear-chapter') { __ipcStore.facts = __ipcStore.facts.filter(f => f.introducedAt !== args[0]); return { success: true } }
    if (channel === 'db:canon-summary-get') return __ipcStore.summaries.get(args[0]) || null
    if (channel === 'db:canon-summary-list-recent') { return Array.from(__ipcStore.summaries.values()).sort((a, b) => b.chapterNumber - a.chapterNumber).slice(0, args[0] || 5) }
    if (channel === 'db:canon-summary-upsert') { __ipcStore.summaries.set(args[0].chapterNumber, args[0]); return { success: true } }
    return null
  },
  on: () => () => {},
  once: () => {},
  send: () => {},
  get isElectron() { return false },
}
export { ipc, __ipcCalls, __ipcStore }
`
writeFileSync(join(tempDir, 'ipc-stub.mjs'), ipcStub)

// 修补 canon-store.mjs 使用 stub
let canonStoreSrc = readFileSync(join(tempDir, 'canon-store.mjs'), 'utf-8')
canonStoreSrc = canonStoreSrc.replace(
  `import { ipc } from '../ipc-client'`,
  `import { ipc } from './ipc-stub.mjs'`,
)
writeFileSync(join(tempDir, 'canon-store.mjs'), canonStoreSrc)

// 修补 context-builder.mjs 使用 stub
let contextBuilderSrc = readFileSync(join(tempDir, 'context-builder.mjs'), 'utf-8')
contextBuilderSrc = contextBuilderSrc.replace(
  `import { canonStore } from './canon-store.mjs'`,
  `import { canonStore } from './canon-store.mjs'`,
)
writeFileSync(join(tempDir, 'context-builder.mjs'), contextBuilderSrc)

// 修补 index.mjs 使用 stub
let indexSrc = readFileSync(join(tempDir, 'index.mjs'), 'utf-8')
indexSrc = indexSrc.replace(
  `from './canon-store.mjs'`,
  `from './canon-store.mjs'`,
)
writeFileSync(join(tempDir, 'index.mjs'), indexSrc)

// ============================================================
// 运行测试
// ============================================================
console.log('[run-standalone] 启动测试...')
const result = spawnSync(process.execPath, ['--test', testPath], {
  stdio: 'inherit',
  cwd: tempDir,
})

// 清理
try { rmSync(tempDir, { recursive: true, force: true }) } catch {}

process.exit(result.status || 0)
