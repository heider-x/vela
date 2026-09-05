import { ILLMProvider, LLMGenerateOptions, LLMResponse, LLMStreamOptions } from './provider.interface'
import { ModelProfile } from '../../src/shared/ipc-channels'

export class OpenAIProvider implements ILLMProvider {
  private supportsResponseFormat(model: ModelProfile): boolean {
    // Ollama Cloud does not support constrained structured output. Keep the
    // requested format in the prompt and validate the result in the caller.
    if (model.provider !== 'ollama') return true
    return !/[:-]cloud$/i.test(model.modelName) && !/^https?:\/\/(?:api\.)?ollama\.com(?:\/|$)/i.test(model.baseUrl)
  }
  private applyThinkingOption(body: Record<string, unknown>, model: ModelProfile, thinking?: boolean) {
    if (thinking === undefined) return
    if (model.provider === 'ollama') {
      // Ollama's OpenAI-compatible endpoint uses reasoning_effort, not its native think field.
      body.reasoning_effort = thinking ? 'high' : 'none'
    } else if (model.provider === 'deepseek' || thinking) {
      body.thinking = { type: thinking ? 'enabled' : 'disabled' }
    }
  }

  private buildUrl(baseUrl: string): string {
    const base = baseUrl.replace(/\/$/, '')
    // 已包含完整路径
    if (base.endsWith('/chat/completions')) {
      return base
    }
    // 已包含 /chat 但缺 /completions
    if (base.endsWith('/chat')) {
      return `${base}/completions`
    }
    // 已包含版本号路径（/v1, /v4 等），直接补全 chat/completions
    if (/\/v\d+$/.test(base)) {
      return `${base}/chat/completions`
    }
    // 无版本号路径，补全 /v1/chat/completions
    return `${base}/v1/chat/completions`
  }

  async generate(model: ModelProfile, messages: Array<{ role: string; content: string }>, opts: LLMGenerateOptions): Promise<LLMResponse> {
    const url = this.buildUrl(model.baseUrl)

    const body: Record<string, unknown> = {
      model: model.modelName,
      messages,
      max_tokens: opts.maxTokens ?? model.maxTokens,
      stream: false,
    }

    // 思考模式下 temperature/top_p 等参数不生效（DeepSeek 会静默忽略），仅在非思考模式下传递
    if (opts.thinking) {
      // thinking 参数直接放在请求体顶层（非 extra_body，那是 OpenAI SDK 层概念）
      this.applyThinkingOption(body, model, true)
    } else {
      this.applyThinkingOption(body, model, opts.thinking)
      if (!opts.responseFormat) body.temperature = opts.temperature ?? model.temperature
    }

    if (opts.responseFormat && this.supportsResponseFormat(model)) body.response_format = opts.responseFormat

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${model.apiKey}`,
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const text = await res.text()
      return { success: false, content: '', error: `API 调用失败 (${res.status}): ${text}` }
    }

    const data = await res.json() as {
      choices: Array<{ finish_reason?: string; message: { content: string; reasoning_content?: string } }>
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
    }

    if (data.choices?.[0]?.finish_reason === 'length') return { success: false, content: '', error: '模型输出达到长度上限，结果不完整，未提交本轮操作。请分段改写或增加模型输出上限。' }
    let finalContent = data.choices?.[0]?.message?.content ?? ''
    // Some Ollama/cloud adapters omit the opening thinking delimiter.
    finalContent = finalContent.replace(/^[\s\S]*<\/think>/i, '')
    finalContent = finalContent.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '').trim()

    return {
      success: true,
      content: finalContent,
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      } : undefined,
    }
  }

  async generateStream(model: ModelProfile, messages: Array<{ role: string; content: string }>, opts: LLMStreamOptions): Promise<void> {
    try {
      const url = this.buildUrl(model.baseUrl)

      const body: Record<string, unknown> = {
        model: model.modelName,
        messages,
        max_tokens: opts.maxTokens ?? model.maxTokens,
        stream: true,
      }

      // 思考模式下 temperature/top_p 等参数不生效（DeepSeek 会静默忽略），仅在非思考模式下传递
      this.applyThinkingOption(body, model, opts.thinking)
      // Some JSON gateways reject custom temperature; thinking mode also owns its sampling settings.
      if (!opts.thinking && !opts.responseFormat) {
        body.temperature = opts.temperature ?? model.temperature
      }

      if (opts.responseFormat && this.supportsResponseFormat(model)) body.response_format = opts.responseFormat

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${model.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: opts.signal,
      })

      if (!res.ok) {
        const text = await res.text()
        opts.onError(`API 调用失败 (${res.status}): ${text}`)
        return
      }

      const reader = res.body?.getReader()
      if (!reader) {
        opts.onError('无法读取响应流')
        return
      }

      const decoder = new TextDecoder()
      let fullText = ''
      let isThinking = false
      let truncated = false

      const handleData = (json: string) => {
        if (json === '[DONE]') return
        try {
          const parsed = JSON.parse(json) as {
            choices: Array<{ finish_reason?: string; delta?: { content?: string, reasoning_content?: string } }>
          }
          if (parsed.choices?.[0]?.finish_reason === 'length') truncated = true
          const delta = parsed.choices?.[0]?.delta

          let emitChunk = ''

          // 如果存在思维链内容
          if (delta?.reasoning_content) {
            if (!isThinking) {
              isThinking = true
              emitChunk += '<think>\n'
            }
            emitChunk += delta.reasoning_content
          } 
          
          // 如果开始输出正文
          if (delta?.content !== undefined && delta?.content !== null) {
            if (isThinking) {
              isThinking = false
              emitChunk += '\n</think>\n\n'
            }
            if (delta?.content) {
              emitChunk += delta.content
            }
          }

          if (emitChunk) {
            fullText += emitChunk
            opts.onChunk(emitChunk)
          }
        } catch {
          // ignore
        }
      }

      // SSE 事件可能跨越网络分片边界，跨块保留未完整行，避免事件被丢弃
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim() // 兼容 \r\n 行尾
          if (trimmed.startsWith('data: ')) {
            handleData(trimmed.slice(6).trim())
          }
        }
      }

      // 流末尾最后一条事件可能没有换行结尾
      if (buffer.trim()) {
        const trimmed = buffer.trim()
        if (trimmed.startsWith('data: ')) {
          handleData(trimmed.slice(6).trim())
        }
      }

      if (isThinking) {
        const closeTag = '\n</think>\n\n'
        fullText += closeTag
        opts.onChunk(closeTag)
      }

      if (truncated) {
        opts.onError('模型输出达到长度上限，结果不完整，未提交本轮操作。请分段改写或增加模型输出上限。')
        return
      }
      opts.onDone(fullText.replace(/^[\s\S]*<\/think>/i, '').replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '').trim())
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        opts.onError('已取消生成')
      } else {
        const cause = (error as { cause?: { message?: string; code?: string } }).cause
        const causeText = cause && (cause.message || cause.code) ? `（底层原因: ${cause.message || cause.code}）` : ''
        opts.onError(String(error) + causeText)
      }
    }
  }
}
