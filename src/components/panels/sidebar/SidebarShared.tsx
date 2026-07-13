/**
 * SidebarShared — 侧边栏共享工具函数、类型定义和常量
 *
 * 所有拆分出的子组件共用这些基础设施。
 */

import React from 'react'
import {
  Target, Users, Globe, Map, BookOpen, FolderTree, LayoutList,
  FilePen, PenTool, BrainCircuit, Sparkles, FolderOpen, Zap,
  FileText, MessageCircle, RefreshCw, GitCompare,
} from 'lucide-react'
import i18n from '../../../i18n'
import type { ContextMenuEntry } from '../../ui/ContextMenu'

// ===== 右键菜单状态管理 =====

export interface SidebarMenuState {
  items: ContextMenuEntry[]
  position: { x: number; y: number }
}

/** 全局单例右键菜单状态 setter（同一时刻只展示一个） */
let _sidebarMenuSetter: ((v: SidebarMenuState | null) => void) | null = null

/** 注册 setter（由 Sidebar 容器调用） */
export function registerMenuSetter(setter: (v: SidebarMenuState | null) => void) {
  _sidebarMenuSetter = setter
}

/** 注销 setter */
export function unregisterMenuSetter() {
  _sidebarMenuSetter = null
}

/** 展示右键菜单 */
export function showSidebarMenu(items: ContextMenuEntry[], e: React.MouseEvent) {
  e.preventDefault()
  e.stopPropagation()
  _sidebarMenuSetter?.({ items, position: { x: e.clientX, y: e.clientY } })
}

// ===== 辅助打开文件函数 =====

import { useEditorStore } from '../../../stores/editor-store'
import { ipc } from '../../../services/ipc-client'

/** 打开架构文件（带 AI 生成工具栏；若 tab 已存在则刷新内容） */
export async function openArchFile(filePath: string, name: string) {
  let content = ''
  // 支持 vela://core/ 伪协议路径，从 DB 读取架构字段
  if (filePath.startsWith('vela://core/')) {
    const { readCoreContent } = await import('../../../services/vela-protocol')
    content = await readCoreContent(filePath)
  } else {
    const result = await ipc.invoke('fs:read-file', filePath)
    content = result.success ? result.content : ''
  }
  const store = useEditorStore.getState()
  const existingTab = store.tabs.find(t => t.id === filePath)
  if (existingTab) {
    // tab 已存在：切换 + 静默刷新磁盘内容（不标记脏数据）
    store.setActiveTab(filePath)
    store.syncTabContent(filePath, content)
  } else {
    store.openFile({
      id: filePath,
      name,
      type: 'arch-file',
      filePath,
      content,
    })
  }
}

/** 打开内置编辑器 */
export function openBuiltinEditor(id: string, name: string, type: 'chapter-card' | 'character' | 'world-building') {
  useEditorStore.getState().openFile({ id, name, type })
}

/** 打开章节文件 */
export async function openChapterFile(filePath: string, name: string) {
  let content = ''
  if (filePath.startsWith('vela://')) {
    const { readVelaContent } = await import('../../../services/vela-protocol')
    content = await readVelaContent(filePath)
  } else {
    const result = await ipc.invoke('fs:read-file', filePath)
    content = result.success ? result.content : ''
  }
  useEditorStore.getState().openFile({
    id: filePath,
    name,
    type: 'chapter',
    filePath,
    content,
  })
}

// ===== 架构文件元信息 =====

export interface ArchFile {
  key: string
  fileName: string
  label: string
  iconName: string
  desc: string
}

export const getArchFiles = (): ArchFile[] => [
  { key: 'premise', fileName: 'premise.md', label: i18n.t('sidebar.premise', { ns: 'panels' }), iconName: 'target', desc: i18n.t('sidebar.premiseDesc', { ns: 'panels' }) },
  { key: 'characters', fileName: 'characters.md', label: i18n.t('sidebar.characterMap', { ns: 'panels' }), iconName: 'users', desc: i18n.t('sidebar.characterMapDesc', { ns: 'panels' }) },
  { key: 'worldbuilding', fileName: 'worldbuilding.md', label: i18n.t('sidebar.worldbuilding', { ns: 'panels' }), iconName: 'globe', desc: i18n.t('sidebar.worldbuildingDesc', { ns: 'panels' }) },
  { key: 'synopsis', fileName: 'synopsis.md', label: i18n.t('sidebar.synopsis', { ns: 'panels' }), iconName: 'map', desc: i18n.t('sidebar.synopsisDesc', { ns: 'panels' }) },
]

/** @deprecated Use getArchFiles() for translated labels */
export const ARCH_FILES: ArchFile[] = [
  { key: 'premise', fileName: 'premise.md', label: 'Premise', iconName: 'target', desc: 'Logline, core conflict, golden finger' },
  { key: 'characters', fileName: 'characters.md', label: 'Character Map', iconName: 'users', desc: 'Character arcs, relationship web' },
  { key: 'worldbuilding', fileName: 'worldbuilding.md', label: 'Worldbuilding', iconName: 'globe', desc: 'Core rules, class fractures' },
  { key: 'synopsis', fileName: 'synopsis.md', label: 'Synopsis', iconName: 'map', desc: 'Three-act plot skeleton' },
]

/** iconName → Lucide 图标组件映射 */
const ICON_MAP: Record<string, React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties }>> = {
  target: Target,
  users: Users,
  globe: Globe,
  map: Map,
  'book-open': BookOpen,
  'folder-tree': FolderTree,
  'layout-list': LayoutList,
  'file-pen': FilePen,
  'pen-tool': PenTool,
  'brain-circuit': BrainCircuit,
  sparkles: Sparkles,
  'folder-open': FolderOpen,
  zap: Zap,
  'file-text': FileText,
  'message-circle': MessageCircle,
  'refresh-cw': RefreshCw,
  'git-compare': GitCompare,
}

/** 根据 iconName 渲染 Lucide 图标；未找到时返回空占位 */
export function renderIcon(iconName: string, size = 14, style?: React.CSSProperties) {
  const Icon = ICON_MAP[iconName]
  if (!Icon) return <span style={{ width: size, height: size, display: 'inline-block', flexShrink: 0, ...style }} />
  return <Icon size={size} style={{ flexShrink: 0, ...style }} />
}

// ===== 从 fileTree 按相对路径找直接子文件 =====


// ===== 通用叶子节点组件 =====

/** 叶子节点（无子级，带可选状态徽章） */
export function LeafItem({
  iconName,
  label,
  desc,
  badge,
  badgeDone,
  badgeColor,
  onClick,
  onContextMenu,
}: {
  iconName: string
  label: string
  desc?: string
  badge?: string
  badgeDone?: boolean
  badgeColor?: string
  onClick?: () => void
  onContextMenu?: (e: React.MouseEvent) => void
}) {
  return (
    <div
      className="tree-item gap-1.5 cursor-pointer select-none"
      style={{ paddingLeft: 10 }}
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={desc}
    >
      <span style={{ width: 12, flexShrink: 0 }} />
      <span className="flex-shrink-0" style={{ color: 'var(--color-text-muted)' }}>{renderIcon(iconName, 14)}</span>
      <span className="text-sm font-medium flex-1 min-w-0 truncate" style={{ color: 'var(--color-text)' }}>{label}</span>
      {badge && (
        <span
          className="text-[0.7rem] flex-shrink-0 ml-1"
          style={{ color: badgeColor || (badgeDone ? 'var(--color-success)' : 'var(--color-text-muted)') }}
        >
          {badge}
        </span>
      )}
    </div>
  )
}
