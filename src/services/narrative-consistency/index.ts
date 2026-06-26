/**
 * Narrative Consistency —— 叙事一致性统一门面
 *
 * 提供：
 *   - CanonStore：持久化 Canon（timeline/character state/plot/fact/summary）
 *   - buildCanonContext / renderCanonContext：生成前注入上下文构建
 *   - validateChapter / tryAutoFix：生成后一致性校验与自动修复
 *   - extractAndWriteback：定稿时从正文提取结构化变更并写回 Canon Store
 *
 * 调用方只需从本文件导入即可使用全部能力。
 */
export * from './types'
export { CanonStore, canonStore } from './canon-store'
export {
  buildCanonContext,
  renderCanonContext,
  HARD_CONSTRAINTS,
  type BuildCanonContextParams,
} from './context-builder'
export {
  validateChapter,
  checkLocationContinuity,
  checkKnowledgeAuthorization,
  checkTimelineOrder,
  checkRelationshipContinuity,
  checkItemOwnership,
  checkPreviousEndingContinuity,
  checkRewriteFactSafety,
  type ValidateParams,
} from './validator'
export { tryAutoFix, issuesToWarnings, buildReport, type AutoFixResult } from './auto-fix'
// v2: Consistency Gate（强制门禁系统）
export {
  runConsistencyGate,
  generateRepairPlan,
  generateRepairContext,
  type GateResult,
  type GateParams,
  type GateSeverity,
  type ClassifiedIssue,
} from './consistency-gate.service'


export { extractCanonWriteback, extractAndWriteback, type ExtractParams } from './fact-extractor'
