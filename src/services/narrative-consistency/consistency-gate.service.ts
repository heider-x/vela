/**
 * ConsistencyGate —— 叙事一致性强制门禁系统
 *
 * 在 finalize-chapter 之前强制运行，决定：
 *   PASS  — 无 HIGH 问题，允许定稿
 *   BLOCK — 存在 HIGH 问题，禁止定稿，必须进入修复循环
 *   REPAIR — 存在 MEDIUM 问题，自动修复后重检
 */
import type {
  CanonContext,
  ConsistencyIssue,
} from './types'
import { validateChapter } from './validator'
import { tryAutoFix } from './auto-fix'

export type GateSeverity = 'LOW' | 'MEDIUM' | 'HIGH'

export interface ClassifiedIssue {
  issue: ConsistencyIssue
  severity: GateSeverity
}

export interface GateResult {
  verdict: 'PASS' | 'BLOCK' | 'REPAIR'
  issues: ClassifiedIssue[]
  repairedContent?: string
  repairAttempts: number
  blockingReasons: string[]
  report: string
  gatedAt: string
}

function mapSeverity(issue: ConsistencyIssue): GateSeverity {
  switch (issue.severity) {
    case 'error':   return 'HIGH'
    case 'warning': return 'MEDIUM'
    case 'info':    return 'LOW'
  }
}

function classifyIssues(issues: ConsistencyIssue[]): ClassifiedIssue[] {
  return issues.map(i => ({ issue: i, severity: mapSeverity(i) }))
}

export interface GateParams {
  chapterNumber: number
  chapterContent: string
  canon: CanonContext
  isRewrite?: boolean
  maxRepairAttempts?: number
}

export async function runConsistencyGate(params: GateParams): Promise<GateResult> {
  const { chapterNumber, chapterContent, canon, isRewrite = false } = params
  const maxAttempts = params.maxRepairAttempts ?? 3
  const blockingReasons: string[] = []

  const issues = validateChapter({ chapterNumber, chapterContent, canon, isRewrite })
  const classified = classifyIssues(issues)
  const highCount = classified.filter(c => c.severity === 'HIGH').length

  if (classified.length === 0) {
    return {
      verdict: 'PASS', issues: [], repairAttempts: 0, blockingReasons: [],
      report: `第${chapterNumber}章一致性检查全部通过`,
      gatedAt: new Date().toISOString(),
    }
  }

  if (highCount === 0 && classified.filter(c => c.severity === 'MEDIUM').length === 0) {
    return {
      verdict: 'PASS', issues: classified, repairAttempts: 0, blockingReasons: [],
      report: `第${chapterNumber}章通过（${classified.length} 项 LOW 级提示）`,
      gatedAt: new Date().toISOString(),
    }
  }

  if (highCount > 0) {
    for (const h of classified.filter(c => c.severity === 'HIGH')) {
      blockingReasons.push(`[${h.issue.category}] ${h.issue.message}`)
    }
    const autoFixResult = tryAutoFix(chapterContent, classified.filter(c => c.severity === 'HIGH').map(c => c.issue))
    if (autoFixResult.modified && autoFixResult.content) {
      const recheck = validateChapter({
        chapterNumber, chapterContent: autoFixResult.content, canon, isRewrite,
      })
      const recheckHighs = classifyIssues(recheck).filter(c => c.severity === 'HIGH')
      if (recheckHighs.length === 0) {
        return {
          verdict: 'REPAIR', issues: classifyIssues(recheck),
          repairedContent: autoFixResult.content, repairAttempts: 1, blockingReasons: [],
          report: `第${chapterNumber}章 ${highCount} 项 HIGH 问题已自动修复`,
          gatedAt: new Date().toISOString(),
        }
      }
      blockingReasons.length = 0
      for (const h of recheckHighs) {
        blockingReasons.push(`[${h.issue.category}] ${h.issue.message}`)
      }
    }
    return {
      verdict: 'BLOCK', issues: classified, repairAttempts: 1, blockingReasons,
      report: `第${chapterNumber}章定稿被阻止 — ${highCount} 项 HIGH 级冲突：\n${blockingReasons.join('\n')}`,
      gatedAt: new Date().toISOString(),
    }
  }

  // MEDIUM only → repair loop
  let workingContent = chapterContent
  let allIssues = classified
  let attempts = 0
  while (attempts < maxAttempts) {
    attempts++
    const mediumIssues = allIssues.filter(c => c.severity === 'MEDIUM')
    if (mediumIssues.length === 0) break
    const fixResult = tryAutoFix(workingContent, mediumIssues.map(c => c.issue))
    if (!fixResult.modified || !fixResult.content) {
      const downgraded = allIssues.map(c =>
        c.severity === 'MEDIUM'
          ? { ...c, severity: 'LOW' as GateSeverity, issue: { ...c.issue, severity: 'info' as const } }
          : c
      )
      return {
        verdict: 'PASS', issues: downgraded, repairAttempts: attempts, blockingReasons: [],
        report: `第${chapterNumber}章通过（${attempts} 次修复后 ${downgraded.filter(c => c.severity === 'LOW').length} 项降级为 LOW）`,
        gatedAt: new Date().toISOString(),
      }
    }
    workingContent = fixResult.content
    const recheck = validateChapter({
      chapterNumber, chapterContent: workingContent, canon, isRewrite,
    })
    allIssues = classifyIssues(recheck)
    const remainingMed = allIssues.filter(c => c.severity === 'MEDIUM').length
    const remainingHigh = allIssues.filter(c => c.severity === 'HIGH').length
    if (remainingMed === 0 && remainingHigh === 0) {
      return {
        verdict: 'REPAIR', issues: allIssues, repairedContent: workingContent,
        repairAttempts: attempts, blockingReasons: [],
        report: `第${chapterNumber}章 ${attempts} 次自动修复后通过一致性检查`,
        gatedAt: new Date().toISOString(),
      }
    }
  }
  const final = allIssues.map(c =>
    c.severity === 'MEDIUM'
      ? { ...c, severity: 'LOW' as GateSeverity, issue: { ...c.issue, severity: 'info' as const } }
      : c
  )
  return {
    verdict: 'PASS', issues: final, repairAttempts: attempts, blockingReasons: [],
    report: `第${chapterNumber}章通过（${attempts} 次修复后 ${final.filter(c => c.severity === 'LOW').length} 项降级为 LOW）`,
    gatedAt: new Date().toISOString(),
  }
}

export function generateRepairPlan(
  issues: ClassifiedIssue[],
  chapterNumber: number,
): string {
  const highs = issues.filter(i => i.severity === 'HIGH')
  const mediums = issues.filter(i => i.severity === 'MEDIUM')
  if (highs.length === 0 && mediums.length === 0) return ''

  const lines: string[] = [`【一致性修复计划 — 第${chapterNumber}章】`, '']
  if (highs.length > 0) {
    lines.push('## 必须修复（HIGH）')
    for (const h of highs) {
      lines.push(`- [${h.issue.category}] ${h.issue.message}`)
      if (h.issue.evidence) lines.push(`  证据：${h.issue.evidence}`)
    }
    lines.push('')
  }
  if (mediums.length > 0) {
    lines.push('## 建议修复（MEDIUM）')
    for (const m of mediums) {
      lines.push(`- [${m.issue.category}] ${m.issue.message}`)
      if (m.issue.evidence) lines.push(`  证据：${m.issue.evidence}`)
    }
    lines.push('')
  }
  lines.push('## 修复指导')
  lines.push('1. 不得为了修复而引入新的事实矛盾')
  lines.push('2. 修复后必须保持与 canon 已确立事实一致')
  lines.push('3. 涉及时间线必须保持事件单调')
  lines.push('4. 涉及角色知识需要显式信息获取途径')
  return lines.join('\n')
}

export function generateRepairContext(
  gateResult: GateResult,
  chapterContent: string,
): string {
  const plan = generateRepairPlan(gateResult.issues, 0)
  return `【自动一致性修复上下文】
以下是在上一轮定稿一致性门禁中检测到的问题。请在修稿时修复这些问题。

${plan}

【原文】
${chapterContent}
`
}
