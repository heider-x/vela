/**
 * Agent 核心引擎 — ReAct（Reasoning + Acting）循环
 *
 * 这是 Agent 的大脑，负责：
 * 1. 将用户消息、系统提示、Tool 描述组装为 LLM 输入
 * 2. 解析 LLM 输出中的 <tool_call> 标签
 * 3. 执行 Tool 并将结果注入为 observation
 * 4. 循环直到 LLM 不再调用 Tool 或达到最大循环次数
 *
 * 参考 Claude Code 的 query.ts 和 QueryEngine 设计，
 * 但简化为 Vela 的 Electron + React 架构。
 */

import i18n from '../../i18n'
import { toolRegistry, type ToolResult, type ToolArtifact } from './tool-registry'

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, { ns: 'panels', ...opts })

// ===== 常量 =====

/** ReAct 循环最大次数（防止死循环） */
const MAX_TOOL_ROUNDS = 32

/** Tool 执行超时（毫秒） */
const TOOL_TIMEOUT_MS = 30_000

/** Tool 返回内容最大长度（字符） */
const TOOL_RESULT_MAX_CHARS = 3000

// ===== 类型 =====

/** Tool 调用信息 */
export interface ToolCallInfo {
  displayName?: string
  id: string
  toolName: string
  arguments: Record<string, unknown>
  status: 'pending' | 'running' | 'completed' | 'failed' | 'waiting_confirm'
  result?: string
  error?: string
  /** Tool 来源标记 */
  source?: string
}

/** Agent Engine 回调 */
export interface AgentEngineCallbacks {
  /** 流式文本片段 */
  onTextChunk: (chunk: string) => void
  /** Tool 调用开始 */
  onToolCallStart: (toolCall: ToolCallInfo) => void
  /** Tool 调用完成 */
  onToolCallComplete: (toolCall: ToolCallInfo) => void
  /** Tool 需要用户确认 */
  onToolCallConfirmRequired: (toolCall: ToolCallInfo) => Promise<boolean>
  /** 全部完成 */
  onDone: (fullText: string, toolCalls: ToolCallInfo[], artifacts: ToolArtifact[]) => void
  /** 错误 */
  onError: (error: string) => void
}

/** LLM 消息格式 */
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** LLM 生成函数签名（由 agent-store 提供实际实现） */
export type LLMGenerateFn = (
  messages: LLMMessage[],
  modelId: string,
) => Promise<string>

// ===== 核心引擎 =====

/**
 * 执行 Agent ReAct 循环
 *
 * 流程：
 * 1. 将系统提示（含 Tool 描述）+ 历史消息 + 用户消息发送给 LLM
 * 2. 解析 LLM 回复中的 <tool_call> 标签
 * 3. 如果有 tool_call → 执行 Tool → 将结果作为 observation 追加到消息历史 → 重新调用 LLM
 * 4. 循环直到 LLM 不再调用 Tool 或达到 MAX_TOOL_ROUNDS
 * 5. 返回最终文本回复
 */
export async function runAgentLoop(
  systemPrompt: string,
  historyMessages: LLMMessage[],
  userMessage: string,
  modelId: string,
  generateFn: LLMGenerateFn,
  callbacks: AgentEngineCallbacks,
  abortSignal?: AbortSignal,
  assertContext?: () => void,
  strictProtocol = false,
): Promise<void> {
  const allToolCalls: ToolCallInfo[] = []
  const allArtifacts: ToolArtifact[] = []

  // 构建消息列表
  const messages: LLMMessage[] = [
    { role: 'system', content: systemPrompt },
    ...historyMessages,
    { role: 'user', content: userMessage },
  ]

  let rounds = 0
  let malformedReplies = 0
  let planOnlyReplies = 0
  let fullAssistantText = ''

  while (rounds < MAX_TOOL_ROUNDS) {
    try { assertContext?.() } catch (error) { callbacks.onError(String(error)); return }
    // 检查中止信号
    if (abortSignal?.aborted) {
      callbacks.onDone(fullAssistantText + '\n\n_(' + t('agent.generationStopped') + ')_', allToolCalls, allArtifacts)
      return
    }

    rounds++

    // 调用 LLM
    let llmResponse: string
    try {
      llmResponse = await generateFn(messages, modelId)
    } catch (error) {
      callbacks.onError(t('agent.engine.llmFailed', { error: String(error) }))
      return
    }

    // 检查中止
    if (abortSignal?.aborted) {
      callbacks.onDone(fullAssistantText + '\n\n_(' + t('agent.generationStopped') + ')_', allToolCalls, allArtifacts)
      return
    }

    // 解析 LLM 回复：分离文本和 tool_call
    const { textParts, toolCalls } = parseToolCalls(llmResponse, strictProtocol)
    if (toolCalls.length === 0 && ((strictProtocol && !textParts.length) || /<tool_call\b/.test(llmResponse) || (/"toolCall"\s*:/.test(llmResponse) && !textParts.length))) {
      if (++malformedReplies >= 3) { callbacks.onError('模型连续返回了无法解析的操作，未执行这些操作。请重试或更换模型。'); return }
      messages.push({ role: 'user', content: '[刚才未返回有效操作，任何工具都尚未执行。请继续原任务，并严格返回一个 JSON 对象：{"message":"中文进展","toolCall":{"name":"工具名","arguments":{}}}。需要询问或任务确实结束时 toolCall=null。不能用“我先读取”这样的纯文本代替工具调用。]' })
      continue
    }
    malformedReplies = 0
    const pendingAction = textParts.join('')
    const actionRequested = /(?:继续(?:执行|完成|改写)|请[\s\S]{0,30}(?:保存|修改|改写|执行)|(?:把|将)[\s\S]{0,100}(?:改成|改为|改写))/.test(userMessage) && !/只讨论|先不要(?:改|写|执行)/.test(userMessage)
    // A progress promise with toolCall=null is not an executed operation. Keep
    // going instead of ending the turn on "I will read/rewrite it now".
    if (strictProtocol && actionRequested && !toolCalls.length && !/[？?]|(?:是否|还是|希望).{0,40}(?:吗|呢|选择)/s.test(pendingAction) &&
        /(?:先|我会|我将|现在|接着|下一步|第一步|继续执行)[\s\S]{0,180}(?:读取|列出|调用|改写|修改|保存|执行)/.test(pendingAction) &&
        !/(?:已完成|已保存|已修改|尚不支持|无法执行)/.test(pendingAction)) {
      if (++planOnlyReplies >= 3) { callbacks.onError('助手停留在计划阶段，尚未执行承诺的操作。请重试或更换模型；已保存的调整仍可在记录中查看。'); return }
      messages.push({ role: 'user', content: '[你刚才只说了准备执行，没有给出工具调用，系统没有执行任何新操作。请立刻返回下一步真实的 toolCall；整章改写可用 rewrite_draft 的 instruction。只有需要作者回答关键问题或任务实际结束时才返回 toolCall=null。]' })
      continue
    }
    planOnlyReplies = 0

    // 输出文本部分（清理可能残留的 tool_call/tool_result 标记）
    let textContent = textParts.join('')
    textContent = textContent
      .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
      .replace(/<tool_result[\s\S]*?<\/tool_result>/g, '')
      .replace(/<\/?tool_call>/g, '')      // 清理孤立的开/闭标签
      .replace(/<\/?tool_result>/g, '')     // 清理孤立的 result 标签
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    if (textContent) {
      callbacks.onTextChunk(textContent)
      fullAssistantText += textContent
    }

    // 如果没有 tool_call，循环结束
    if (toolCalls.length === 0) {
      callbacks.onDone(fullAssistantText, allToolCalls, allArtifacts)
      return
    }

    // 将 LLM 的完整回复加入历史（包含 tool_call 标签）
    messages.push({ role: 'assistant', content: JSON.stringify({ message: textContent, ...(toolCalls.length === 1 ? { toolCall: toolCalls[0] } : { toolCalls }) }) })

    // 依次执行每个 tool_call
    const observationParts: string[] = []

    for (const tc of toolCalls) {
      if (abortSignal?.aborted) { callbacks.onDone(fullAssistantText, allToolCalls, allArtifacts); return }
      try { assertContext?.() } catch (error) { callbacks.onError(String(error)); return }
      const toolCallInfo: ToolCallInfo = {
        id: crypto.randomUUID(),
        toolName: tc.name,
        arguments: tc.arguments,
        status: 'pending',
      }
      allToolCalls.push(toolCallInfo)

      // 查找 Tool
      const tool = toolRegistry.get(tc.name)
      if (!tool) {
        toolCallInfo.status = 'failed'
        toolCallInfo.error = t('agent.engine.unknownTool', { name: tc.name })
        callbacks.onToolCallComplete(toolCallInfo)
        observationParts.push(`<tool_result name="${tc.name}" error="true">\n未知工具：${tc.name}。可用工具：${toolRegistry.listAll().map(t => t.name).join(', ')}\n</tool_result>`)
        continue
      }

      // 记录来源
      toolCallInfo.source = tool.source
      toolCallInfo.displayName = tool.userFacingName ?? tool.name

      // 需要用户确认的 Tool
      if (tool.requiresConfirmation) {
        toolCallInfo.status = 'waiting_confirm'
        callbacks.onToolCallStart(toolCallInfo)

        const confirmed = await callbacks.onToolCallConfirmRequired(toolCallInfo)
        try { assertContext?.() } catch (error) { callbacks.onError(String(error)); return }
        if (!confirmed) {
          toolCallInfo.status = 'failed'
          toolCallInfo.error = t('agent.engine.userRejected')
          callbacks.onToolCallComplete(toolCallInfo)
          observationParts.push(`<tool_result name="${tc.name}" error="true">\n用户拒绝了此操作\n</tool_result>`)
          continue
        }
      }

      // 执行 Tool
      toolCallInfo.status = 'running'
      callbacks.onToolCallStart(toolCallInfo)
      const toolAbort = new AbortController()
      const cancelTool = () => toolAbort.abort()
      abortSignal?.addEventListener('abort', cancelTool, { once: true })
      if (abortSignal?.aborted) toolAbort.abort()

      try {
        const result = await executeToolWithTimeout(args => tool.execute(args, { signal: toolAbort.signal, modelId }), tc.arguments, tool.timeoutMs ?? TOOL_TIMEOUT_MS, cancelTool)

        // 截断过长的结果
        const truncatedContent = truncateResult(result.content, tool.maxResultChars ?? TOOL_RESULT_MAX_CHARS)

        toolCallInfo.status = result.success ? 'completed' : 'failed'
        toolCallInfo.result = truncatedContent
        if (result.error) toolCallInfo.error = result.error
        if (result.artifacts) allArtifacts.push(...result.artifacts)

        callbacks.onToolCallComplete(toolCallInfo)

        if (result.success) {
          observationParts.push(`<tool_result name="${tc.name}">\n${truncatedContent}\n</tool_result>`)
        } else {
          observationParts.push(`<tool_result name="${tc.name}" error="true">\n${result.error ?? truncatedContent}\n</tool_result>`)
        }
      } catch (error) {
        toolCallInfo.status = 'failed'
        toolCallInfo.error = t('agent.engine.execError', { error: String(error) })
        callbacks.onToolCallComplete(toolCallInfo)
        observationParts.push(`<tool_result name="${tc.name}" error="true">\n执行异常：${String(error)}\n</tool_result>`)
      } finally { abortSignal?.removeEventListener('abort', cancelTool) }
    }

    // 将所有 tool 结果作为 user role 的 observation 注入
    // 加上明确提示，防止 LLM 误以为这是用户新发言
    const observation = `[以下是工具执行结果，请根据结果继续回答用户的问题]\n\n${observationParts.join('\n\n')}\n\n[请根据上面的工具结果，继续回答用户的原始问题。如果需要更多信息可以继续调用工具。]`
    messages.push({ role: 'user', content: observation })
  }

  // 达到最大循环次数
  if (rounds >= MAX_TOOL_ROUNDS) {
    fullAssistantText += '\n\n' + t('agent.engine.maxRounds')
  }

  callbacks.onDone(fullAssistantText, allToolCalls, allArtifacts)
}

// ===== 工具函数 =====

/** 解析的 Tool 调用 */
interface ParsedToolCall {
  name: string
  arguments: Record<string, unknown>
}

/**
 * 从 LLM 输出中解析 <tool_call>...</tool_call> 标签
 *
 * 返回分离后的文本片段和 tool 调用列表。
 * 增强版：支持 JSON 前后有多余文字的容错解析。
 */
export function parseToolCalls(text: string, requireStructured = false): {
  textParts: string[]
  toolCalls: ParsedToolCall[]
} {
  // A JSON envelope avoids model-specific parsers consuming XML tool tags.
  // Extract the last complete envelope when a gateway prefixes untagged reasoning.
  const clean = text.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '').replace(/```(?:json)?\s*/gi, '').trim()
  for (let start = clean.length - 1; start >= 0; start--) {
    if (clean[start] !== '{') continue
    let depth = 0, quoted = false, escaped = false
    for (let end = start; end < clean.length; end++) {
      const ch = clean[end]
      if (quoted) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') quoted = false; continue }
      if (ch === '"') quoted = true
      else if (ch === '{' || ch === '[') depth++
      else if (ch === '}' || ch === ']') depth--
      if (depth !== 0) continue
      try {
        const data = JSON.parse(clean.slice(start, end + 1))
        // Never execute a format example embedded in reasoning when the actual
        // response at the end is truncated or malformed.
        if (clean.slice(end + 1).trim()) break
        if (typeof data.message === 'string' && Object.hasOwn(data, 'toolCall')) {
          if (data.toolCall === null) return { textParts: requireStructured && !data.message.trim() ? [] : [data.message], toolCalls: [] }
          const call = data.toolCall
          if (!call || typeof call.name !== 'string' || !call.arguments || typeof call.arguments !== 'object' || Array.isArray(call.arguments)) return { textParts: [], toolCalls: [] }
          return { textParts: data.message ? [data.message] : [], toolCalls: [{ name: call.name, arguments: call.arguments }] }
        }
      } catch { /* Continue to a complete outer envelope. */ }
      break
    }
  }
  if (/"toolCall"\s*:/.test(clean) && !/<tool_call\b/.test(clean)) return { textParts: [], toolCalls: [] }
  if (requireStructured && !/<tool_call\b/.test(clean)) return { textParts: [], toolCalls: [] }
  const toolCalls: ParsedToolCall[] = []
  const textParts: string[] = []

  // 匹配 <tool_call>...</tool_call> 标签
  const regex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g
  let lastIndex = 0
  let match: RegExpExecArray | null = null

  while ((match = regex.exec(text)) !== null) {
    // 收集标签前的文本
    if (match.index > lastIndex) {
      const before = text.slice(lastIndex, match.index).trim()
      if (before) textParts.push(before)
    }
    lastIndex = regex.lastIndex

    // 解析 JSON（增强容错）
    const rawContent = match[1].trim()
    let parsed = false

    // 策略 1：直接解析整个内容
    try {
      const data = JSON.parse(rawContent)
      if (data.name && typeof data.name === 'string') {
        toolCalls.push({ name: data.name, arguments: data.arguments ?? {} })
        parsed = true
      }
    } catch { /* 尝试容错解析 */ }

    // 策略 2：从内容中提取 JSON 对象（LLM 可能在 JSON 前后加了额外文字）
    if (!parsed) {
      const jsonMatch = rawContent.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        try {
          const data = JSON.parse(jsonMatch[0])
          if (data.name && typeof data.name === 'string') {
            toolCalls.push({ name: data.name, arguments: data.arguments ?? {} })
            parsed = true
          }
        } catch {
          console.warn('[AgentEngine] tool_call JSON 容错解析也失败:', rawContent)
        }
      }
    }

    // 完全解析失败，丢弃该标签（不再打回 textParts，避免泄露 XML）
    if (!parsed) {
      console.warn('[AgentEngine] tool_call 标签解析失败，已丢弃:', rawContent)
    }
  }

  // 收集最后一个标签后的文本
  if (lastIndex < text.length) {
    const after = text.slice(lastIndex).trim()
    if (after) textParts.push(after)
  }

  // 如果没有匹配到任何标签，整个文本都是 textParts
  if (toolCalls.length === 0 && textParts.length === 0) {
    if (!/<tool_call\b/.test(text)) textParts.push(text)
  }

  return { textParts, toolCalls }
}

/**
 * 带超时的 Tool 执行
 */
async function executeToolWithTimeout(
  executeFn: (args: Record<string, unknown>) => Promise<ToolResult>,
  args: Record<string, unknown>,
  timeoutMs: number,
  onTimeout?: () => void,
): Promise<ToolResult> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      executeFn(args),
      new Promise<ToolResult>((_, reject) => { timer = setTimeout(() => { onTimeout?.(); reject(new Error(t('agent.engine.toolTimeout', { seconds: timeoutMs / 1000 }))) }, timeoutMs) }),
    ])
  } finally { clearTimeout(timer) }
}

/**
 * 截断过长的 Tool 结果
 */
function truncateResult(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content
  return content.slice(0, maxChars) + '\n\n' + t('agent.engine.resultTruncated', { count: content.length })
}
