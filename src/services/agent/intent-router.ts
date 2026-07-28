/**
 * 意图路由 + / 命令解析
 *
 * 负责：
 * 1. 解析 /command 格式的斜杠命令
 * 2. 解析 @mention 格式的上下文提及
 * 3. 路由用户消息到对应的处理逻辑
 */

import i18n from '../../i18n'
import { skillRegistry, type LoadedSkill } from './skill-registry'

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, { ns: 'panels', ...opts })

// ===== 类型定义 =====

/** / 命令 */
export interface SlashCommand {
  /** 命令名（不含 /） */
  name: string
  /** 显示名称 */
  displayName: string
  /** 描述 */
  description: string
  /** 来源类型 */
  source: 'builtin_command' | 'skill'
  /** 关联的 Skill（如有） */
  skill?: LoadedSkill
}

/** @ 提及目标 */
export interface MentionTarget {
  /** 提及类型 */
  type: 'chapter' | 'character' | 'architecture' | 'blueprint' | 'knowledge' | 'file'
  /** 显示名称 */
  displayName: string
  /** 提及值（传递给 Tool） */
  value: string
  /** 图标 emoji */
  icon: string
}

/** 提及解析结果 */
export interface ParsedMention {
  target: MentionTarget
  /** 在原文中的起止位置 */
  start: number
  end: number
}

// ===== / 命令管理 =====

/** 内置 / 命令列表 */
const BUILTIN_COMMANDS: SlashCommand[] = [
  {
    name: 'clear',
    displayName: t('agent.slash.clearName'),
    description: t('agent.slash.clearDesc'),
    source: 'builtin_command',
  },
  {
    name: 'new',
    displayName: t('agent.slash.newName'),
    description: t('agent.slash.newDesc'),
    source: 'builtin_command',
  },
  {
    name: 'help',
    displayName: t('agent.slash.helpName'),
    description: t('agent.slash.helpDesc'),
    source: 'builtin_command',
  },
  {
    name: 'status',
    displayName: t('agent.slash.statusName'),
    description: t('agent.slash.statusDesc'),
    source: 'builtin_command',
  },
]

/**
 * 获取所有可用的 / 命令（内置 + Skill）
 */
export function getAllSlashCommands(): SlashCommand[] {
  const commands: SlashCommand[] = [...BUILTIN_COMMANDS]

  // 把所有 Skill 也注册为 / 命令
  for (const skill of skillRegistry.listAll()) {
    if (skill.metadata.userInvocable !== false) {
      commands.push({
        name: skill.metadata.name,
        displayName: skill.metadata.displayName ?? skill.metadata.name,
        description: skill.metadata.description,
        source: 'skill',
        skill,
      })
    }
  }

  return commands
}

/**
 * 模糊搜索 / 命令
 */
export function searchSlashCommands(query: string): SlashCommand[] {
  const q = query.toLowerCase()
  return getAllSlashCommands().filter(cmd =>
    cmd.name.toLowerCase().includes(q) ||
    cmd.displayName.toLowerCase().includes(q) ||
    cmd.description.toLowerCase().includes(q)
  )
}

/**
 * 判断用户输入是否以 / 开头
 */
export function isSlashCommand(input: string): boolean {
  return input.trimStart().startsWith('/')
}

/**
 * 解析 / 命令
 */
export function parseSlashCommand(input: string): {
  command: SlashCommand | null
  args: string
} {
  const trimmed = input.trimStart()
  if (!trimmed.startsWith('/')) {
    return { command: null, args: '' }
  }

  const withoutSlash = trimmed.slice(1)
  const spaceIndex = withoutSlash.indexOf(' ')
  const cmdName = spaceIndex > -1 ? withoutSlash.slice(0, spaceIndex) : withoutSlash
  const args = spaceIndex > -1 ? withoutSlash.slice(spaceIndex + 1).trim() : ''

  const command = getAllSlashCommands().find(c => c.name === cmdName) ?? null

  return { command, args }
}

// ===== @ 提及管理 =====

/**
 * 获取所有可 @ 提及的目标
 */
export function getAllMentionTargets(): MentionTarget[] {
  return [
    { type: 'architecture', displayName: t('agent.mentionTargets.architecture'), value: 'architecture', icon: '📐' },
    { type: 'character', displayName: t('agent.mentionTargets.character'), value: 'characters', icon: '👤' },
    { type: 'blueprint', displayName: t('agent.mentionTargets.blueprint'), value: 'blueprints', icon: '📋' },
    { type: 'knowledge', displayName: t('agent.mentionTargets.knowledge'), value: 'knowledge', icon: '📚' },
    { type: 'chapter', displayName: t('agent.mentionTargets.chapter'), value: 'current_chapter', icon: '📝' },
    { type: 'file', displayName: t('agent.mentionTargets.file'), value: 'file', icon: '📄' },
  ]
}

/**
 * 模糊搜索 @ 提及目标
 */
export function searchMentionTargets(query: string): MentionTarget[] {
  const q = query.toLowerCase()
  return getAllMentionTargets().filter(t =>
    t.displayName.toLowerCase().includes(q) ||
    t.value.toLowerCase().includes(q)
  )
}

/**
 * 解析输入中的 @ 提及
 */
export function parseMentions(input: string): ParsedMention[] {
  const mentions: ParsedMention[] = []
  const regex = /@(\S+)/g
  let match: RegExpExecArray | null = null

  while ((match = regex.exec(input)) !== null) {
    const value = match[1]
    const target = getAllMentionTargets().find(t =>
      t.value === value || t.displayName === value
    )
    if (target) {
      mentions.push({
        target,
        start: match.index,
        end: match.index + match[0].length,
      })
    }
  }

  return mentions
}

/**
 * 将提及转换为 Tool 调用上下文
 * 返回需要预先调用的 Tool 名称和参数列表
 */
export function mentionsToToolCalls(mentions: ParsedMention[]): Array<{
  toolName: string
  args: Record<string, unknown>
}> {
  return mentions.map(m => {
    switch (m.target.type) {
      case 'architecture':
        return { toolName: 'read_architecture', args: {} }
      case 'character':
        return { toolName: 'read_characters', args: {} }
      case 'blueprint':
        return { toolName: 'read_blueprint', args: {} }
      case 'knowledge':
        return { toolName: 'search_knowledge', args: { query: '' } }
      case 'chapter':
        return { toolName: 'list_chapters', args: {} }
      case 'file':
        return { toolName: 'read_file', args: { file_path: '' } }
      default:
        return { toolName: 'read_project_state', args: {} }
    }
  })
}
