/**
 * Agent 智能上下文构建器
 *
 * 采用三级注入策略管理 Token 消耗：
 * - L0 始终注入（~500 token）：项目名称/类型/进度/一句话大纲
 * - L1 编辑器感知（~800 token）：当前打开的 Tab 信息
 * - L2 按需获取：通过 Tool 调用获取详细数据
 *
 * 这是 Agent 理解用户上下文的核心模块。
 */

import { useProjectStore } from '../../stores/project-store'
import { useEditorStore } from '../../stores/editor-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import type { AgentMode } from '../../stores/agent-store'
import { toolRegistry } from './tool-registry'

// ===== 上下文构建 =====

/**
 * 构建 Agent 系统提示词（含上下文和 Tool 描述）
 *
 * 这是 Agent 每次对话时的系统提示词入口。
 * 将项目上下文、编辑器状态、可用 Tool 列表整合为一份完整的系统提示。
 */
export function buildAgentSystemPrompt(mode: AgentMode): string {
  const sections: string[] = []

  // 1. Agent 身份与行为指导
  sections.push(buildIdentityPrompt(mode))

  // 2. L0 — 始终注入的项目上下文
  const l0 = buildL0ProjectContext()
  if (l0) sections.push(l0)

  // 3. L1 — 编辑器感知上下文
  const l1 = buildL1EditorContext()
  if (l1) sections.push(l1)

  // 4. Tool 系统提示词
  const toolPrompt = toolRegistry.generateToolPrompt()
  if (toolPrompt) sections.push(toolPrompt)

  return sections.join('\n\n---\n\n')
}

// ===== 内部构建方法 =====

/** Agent 身份提示词 */
function buildIdentityPrompt(mode: AgentMode): string {
  const modeDesc = mode === 'planning'
    ? '当前处于 Planning 模式：你可以先规划再执行，适合复杂的多步骤任务。请先分析需求，制定方案，再逐步执行。'
    : '当前处于 Fast 模式：你直接高效地完成任务，适合简单快速的操作。'

  return `# Vela AI 创作助手

你是 Vela 智能创作助手，专注于帮助作家进行长篇小说创作。

${modeDesc}

## 核心能力
- 📖 深入理解小说项目的架构、人物、情节，提供专业的创作建议
- 🔍 通过工具调用主动获取项目数据（架构文件、角色卡、蓝图、草稿等）
- ✏️ 通过 revise_story 直接修改已有设定、角色、蓝图和最新草稿正文，保存前后对照并支持撤回
- 🧠 结合知识库做检索增强生成（RAG）

## 行为规范
你是作者的协作写作助手。作者可以直接说“反派提前下线”“改善某人的后续境遇”“后面转向势力博弈”。你负责把抽象意图落实为作品内容的关联调整。

## 剧情调整的工作方法
1. 先用 search_story 定位人物、事件及关联内容；用 read_story 读取原文、字段和版本。长内容必须按 nextOffset 继续读取；搜索摘要不能当作读过原文。阅读相关已写草稿作为既成事实，区分未来计划与已经发生的情节。
2. 检查全书大纲 synopsis、人物架构 charactersArch、全局指导 globalGuidance、对应角色卡和后续蓝图的关联。不要只改人物卡就声称整个剧情已调整。
3. 不确定时先查作品。仍存在关键歧义（例如下线是死亡还是退场、时间点、是否改变人物底色）时，用自然语言集中询问作者，给出建议与理由，并结束本轮等待答复。不要猜测作者选择，不要一边询问一边提交依赖该答案的修改。不要询问作者文件路径、字段名等实现细节。
4. 作者明确要求执行且方向清楚后，直接用 revise_story 联动修改，无需为每个字段重复确认。仅讨论、征求意见、分析、假设的问题不得写入。调整未来剧情默认保留已写正文；作者明确要求改写正文时（例如“小说改成第三人称”），必须逐章完整读取已有最新草稿，用 kind=draft,field=content,edit_written_text=true 实际修改，不能只改文风配置就结束。已定稿/归档版本暂不可覆盖，明确报告这些未处理的章节。
5. 使用精确替换最小必要的原文片段，保留不相关的好内容。调整人物动机、因果衔接、尚未兑现的伏笔与后续章节；同时核对蓝图的出场人物 characters（JSON 姓名数组）、目标 purpose 和悬念 suspenseHook，避免只改事件而遗漏关联字段。若后续蓝图尚未生成，修改架构与指导，明确说明尚无蓝图可改。
6. 修改前简述影响；summary 写清如何接续旧冲突和伏笔、保留范围、尚未解决事项。任何未读、未处理的部分都不能声称完成一致性检查。工具保存成功才报告已修改，失败时根据原因重新读取或向作者说明。
7. 保存后重新搜索/读取受影响内容，检查旧安排是否残留；必要时继续修正。给出实际修改范围、剩余问题及撤回入口，不能只给建议就结束明确要求执行的任务。
8. 后续对话优先尊重作者已经明确的选择，必要时通过 story_changes 回看调整记录；记录反映当时意图，当前正文仍以 read_story 的结果为准。
9. 架构、角色、蓝图、正文是数据库资源，使用 revise_story；禁止为这些资源生成假 Markdown 文件或用 write_file 绕开内容接口。旧对话中的 start_workflow 只曾打开面板，并未执行任务；它已停用，不要再次调用、声称工作流已经启动或把明确的修改请求交回作者手动操作。
10. 整章改写首选 rewrite_draft：读取原文后提交简洁的 instruction 和读取版本，由工具内部真正调用写作模型、改稿并保存；不要在主对话里反复起草全文。也可直接提交完整 content；禁止占位符。转换视角还要读取 core 的 narrativePov（枚举 first_person / third_limited / third_omniscient / multi_pov），与 writingStyle 一起调整，防止下次生成沿用旧视角。转换叙述视角时保留事件、人物、数字、对话与章末钩子；第三人称限制视角只写视角人物所知所感，不能机械替换对话里的“我”。长正文必须读完 nextOffset；改完再读取核对。全文任务要列出全部现有章节，逐章处理并汇报实际覆盖范围。未生成章节通过文风约束后续创作，不能声称已改了不存在的正文。回复只写面向作者的中文进展、问题或结论，不输出自言自语或英文分析。

## 通用要求
- 使用中文回复
- 回答应当专业、具体、富有创意
- 主动使用工具获取所需信息，而非要求用户提供
- 对于写入型操作（修改文件、触发工作流），先说明你要做什么，再调用工具
- 如果需要多步操作，可以逐步调用多个工具`
}

/**
 * L0 — 始终注入的项目上下文
 * 约 300-500 token，每次对话都注入
 */
function buildL0ProjectContext(): string | null {
  const project = useProjectStore.getState().currentProject
  if (!project) return null

  const cfg = project.novelConfig
  const parts: string[] = [
    `## 当前项目上下文`,
    `项目名称：《${project.name}》`,
  ]

  if (cfg.genre) {
    parts.push(`类型：${cfg.genre}${cfg.subGenre ? ' · ' + cfg.subGenre : ''}`)
  }
  if (cfg.targetAudience) {
    parts.push(`目标读者：${cfg.targetAudience}`)
  }
  if (cfg.totalChapters) {
    parts.push(`计划章节数：${cfg.totalChapters} 章`)
  }
  if (cfg.wordsPerChapter) {
    parts.push(`每章字数：约 ${cfg.wordsPerChapter} 字`)
  }
  if (cfg.narrativePOV) {
    const povMap: Record<string, string> = {
      'third_limited': '第三人称有限',
      'first_person': '第一人称',
      'third_omniscient': '第三人称全知',
      'multi_pov': '多视角',
    }
    parts.push(`叙事视角：${povMap[cfg.narrativePOV] ?? cfg.narrativePOV}`)
  }
  if (cfg.coreOutline) {
    // 截取前 300 字符，避免 Token 爆炸
    const outline = cfg.coreOutline.length > 300
      ? cfg.coreOutline.slice(0, 300) + '…'
      : cfg.coreOutline
    parts.push(`核心大纲：${outline}`)
  }
  if (cfg.writingStyle) {
    const style = cfg.writingStyle.length > 150
      ? cfg.writingStyle.slice(0, 150) + '…'
      : cfg.writingStyle
    parts.push(`写作风格：${style}`)
  }

  return parts.join('\n')
}

/**
 * L1 — 编辑器感知上下文
 * 约 200-500 token，注入当前打开的 Tab 信息和工作流状态
 */
function buildL1EditorContext(): string | null {
  const parts: string[] = []

  // 当前打开的编辑器 Tab
  const editorState = useEditorStore.getState()
  if (editorState.tabs.length > 0) {
    const activeTab = editorState.tabs.find(t => t.id === editorState.activeTabId)
    const tabSummaries = editorState.tabs.map(t => {
      const active = t.id === editorState.activeTabId ? ' [当前活跃]' : ''
      const dirty = t.dirty ? ' [未保存]' : ''
      return `  - ${t.name} (${t.type})${active}${dirty}`
    }).join('\n')

    parts.push(`## 编辑器状态\n打开的文件：\n${tabSummaries}`)

    // 如果当前活跃 Tab 有内容且不太长，注入内容摘要
    if (activeTab?.content && activeTab.content.length > 0) {
      const preview = activeTab.content.length > 500
        ? activeTab.content.slice(0, 500) + '\n…（内容过长已截断，可通过 read_file 工具获取完整内容）'
        : activeTab.content
      parts.push(`### 当前活跃文件内容\n文件名：${activeTab.name}\n\`\`\`\n${preview}\n\`\`\``)
    }
  }

  // 当前工作流状态
  const workflowState = useWorkflowStore.getState()
  if (workflowState.hasActiveRun()) {
    const run = workflowState.currentRun
    if (run) {
      parts.push(`## 工作流状态\n当前有工作流正在运行：${run.title}（进度：${run.currentStepIndex + 1}/${run.steps.length}）`)
    }
  }

  return parts.length > 0 ? parts.join('\n\n') : null
}
