/**
 * 草稿状态共享常量与类型
 * — 统一 Sidebar、DraftEditor 等多处的状态标签和颜色显示，避免重复定义和不一致
 */

import i18n from '../i18n'

/** 草稿状态类型 */
export type DraftStatus = 'draft' | 'revised' | 'reviewed' | 'finalized' | 'archived'


/** 草稿状态 → 多语言标签（运行时动态获取） */
export const DRAFT_STATUS_LABEL: Record<string, string> = {
  draft:     i18n.t('draftStatus.draft', { ns: 'panels' }),
  revised:   i18n.t('draftStatus.revised', { ns: 'panels' }),
  reviewed:  i18n.t('draftStatus.reviewed', { ns: 'panels' }),
  finalized: i18n.t('draftStatus.finalized', { ns: 'panels' }),
  archived:  i18n.t('draftStatus.archived', { ns: 'panels' }),
}

/** 草稿状态 → 显示颜色（使用 CSS 变量保证主题适配） */
export const DRAFT_STATUS_COLOR: Record<string, string> = {
  draft:     'var(--color-text-muted)',
  revised:   '#60a5fa',           /* 蓝色 — 表示已有改进 */
  reviewed:  '#a78bfa',           /* 紫色 — 表示已审核 */
  finalized: 'var(--color-success)',
  archived:  'var(--color-text-muted)',
}
