import { buildAgentTool } from '../tool-registry'
import { ipc } from '../../ipc-client'
import { useProjectStore } from '../../../stores/project-store'
import { useLLMStore } from '../../../stores/llm-store'
import { applyRevision, assertStoryProject, undoRevision } from '../story-revision-service'
import type { StoryReadRequest, StoryRevisionRequest } from '../../../shared/story-revision'

function projectPath() {
  const path = useProjectStore.getState().currentProject?.path
  if (!path) throw new Error('请先打开小说项目。')
  assertStoryProject(path)
  return path
}

export const storyIndexTool = buildAgentTool({
  name: 'search_story', userFacingName: '查找作品内容', source: 'builtin', requiresConfirmation: false, maxResultChars: 12000,
  description: '搜索当前作品的设定、角色、蓝图及已写草稿，建立修改影响范围。query 为空列出目录；有 nextOffset 必须继续翻页。摘要仅供定位，正文用 read_story 读取。',
  inputSchema: { type: 'object', properties: { query: { type: 'string', description: '人物名、事件词或空字符串；可分多次搜索相关人物和伏笔。' }, offset: { type: 'number', description: '分页位置，首次为 0。' } } },
  execute: async args => ({ success: true, content: JSON.stringify(await ipc.invoke('story:index', projectPath(), args.query as string | undefined, args.offset as number | undefined)) }),
})
export const storyReadTool = buildAgentTool({
  name: 'read_story', userFacingName: '读取作品原文', source: 'builtin', requiresConfirmation: false, maxResultChars: 12000,
  description: '读取可修改内容及版本。kind=core,id=main 包含全书架构和指导；blueprint 的 id 是章节号字符串；character 的 id 是姓名；draft 的 id 来自目录。先不传 field 查看字段列表，再按 field 读取。nextOffset 非空说明尚未读完。version 用于保存时检查并发变化。',
  inputSchema: { type: 'object', properties: {
    kind: { type: 'string', enum: ['core', 'blueprint', 'character', 'draft'], description: '内容类型。' },
    id: { type: 'string', description: '目录中的内容标识。' }, field: { type: 'string', description: 'fieldLengths 中的字段名。' }, offset: { type: 'number', description: '继续读取的位置，首次 0。' },
  }, required: ['kind', 'id'] },
  execute: async args => ({ success: true, content: JSON.stringify(await ipc.invoke('story:read', projectPath(), args as unknown as StoryReadRequest)) }),
})
export const storyReviseTool = buildAgentTool({
  name: 'revise_story', userFacingName: '联动调整剧情', source: 'builtin', requiresConfirmation: false, isReadOnly: false, maxResultChars: 12000,
  description: '按作者明确的修改意图，原子保存设定、角色、蓝图及最新草稿正文。先完整读取相关原文并解决关键歧义。edits_json 是 JSON 数组，每项含 kind,id,version,field,oldText,newText；用唯一原文片段精确替换，空 oldText 只允许填空字段。改正文用 kind=draft,field=content，且 edit_written_text=true；已定稿/归档正文不可覆盖。成功后正文直接保存并在编辑器显示，返回可撤回的前后记录；失败则整次不写。不要用 write_file 或工作流入口修改数据库内容。',
  inputSchema: { type: 'object', properties: {
    intent: { type: 'string', description: '用一句简短的话概括作者已明确的创作要求，不编造作者选择。' },
    summary: { type: 'string', description: '面向作者，用中文简述具体影响、因果衔接、伏笔处理和保留范围，说明未处理事项。使用“大纲、人物发展”等创作术语，不写字段名、接口名或授权说明。' },
    edit_written_text: { type: 'boolean', description: '只有作者明确要求改写已写正文（如全文改成第三人称）时设为 true。仅调整未来剧情时不设置。' },
    edits_json: { type: 'string', description: '修改数组 JSON，1–60 项。每项示例：{"kind":"blueprint","id":"5","version":"读取到的version","field":"keyEvents","oldText":"原文唯一片段","newText":"修改后的片段"}。同一字段多项按顺序执行。' },
  }, required: ['intent', 'summary', 'edits_json'] },
  execute: async (args, context) => {
    const path = projectPath()
    const request: StoryRevisionRequest = { intent: args.intent as string, summary: args.summary as string, edits: JSON.parse(args.edits_json as string), editWrittenText: args.edit_written_text === true }
    const revision = await applyRevision(path, request, context?.signal)
    return { success: true, content: JSON.stringify({ id: revision.id, status: revision.status, summary: revision.summary, savedAndVerified: revision.changes.map(c => ({ kind: c.kind, id: c.id, field: c.field })) }), artifacts: [{ type: 'story_revision', name: revision.intent, path, revisionId: revision.id }] }
  },
})
export const storyHistoryTool = buildAgentTool({
  name: 'story_changes', userFacingName: '查看剧情调整记录', source: 'builtin', requiresConfirmation: false, maxResultChars: 12000,
  description: '查看本作品最近 10 次剧情调整及撤回状态。记录是历史意图，现状必须重新读取。',
  inputSchema: { type: 'object', properties: {} },
  execute: async () => ({ success: true, content: JSON.stringify((await ipc.invoke('story:history', projectPath())).slice(0, 10).map(r => ({ id: r.id, intent: r.intent, summary: r.summary, status: r.status, changed: r.changes.map(c => `${c.title}/${c.field}`) }))) }),
})
export const storyRewriteDraftTool = buildAgentTool({
  name: 'rewrite_draft', userFacingName: '改写整章正文', source: 'builtin', requiresConfirmation: false, isReadOnly: false, maxResultChars: 12000, timeoutMs: 600000,
  description: '作者明确要求整章改写时首选此工具。先读取最新草稿，再给出具体 instruction，工具会真正调用当前写作模型完成改稿、保存、打开正文并记录前后内容；等待返回实际结果即可。不要在主对话先生成全文或用工作流面板代替执行。也可直接提交完整 content（二选一）。按 version 检查原稿未变，可撤回。只改该草稿，文风和视角配置另用 revise_story 同步。已定稿/归档版本不可覆盖。',
  inputSchema: { type: 'object', properties: {
    id: { type: 'string', description: 'read_story 读取的草稿 id。' },
    version: { type: 'string', description: '完整读取原稿时返回的 version，原样传入。' },
    intent: { type: 'string', description: '作者已明确的改写方向。' },
    summary: { type: 'string', description: '用中文说明这章改了什么、保留什么及未完成之处。' },
    instruction: { type: 'string', description: '首选：用自然语言给写作模型完整改稿要求，例如“改成跟随林舟的第三人称限制视角；保持原有事件、数字、对话、段落与末尾范围，不新增情节”。工具实际执行生成和保存。与 content 二选一。' },
    content: { type: 'string', description: '完整的新正文，保留章节标题、段落与对话。不要写摘要、占位符、省略号或“后文同上”来代替正文；不得只交首段。换行使用 JSON 标准换行转义。' },
  }, required: ['id', 'version', 'intent', 'summary'] },
  execute: async (args, context) => {
    const path = projectPath()
    const parts: string[] = []
    let offset: number | null = 0
    do {
      const doc: import('../../../shared/story-revision').StoryReadResult = await ipc.invoke('story:read', path, { kind: 'draft', id: args.id as string, field: 'content', offset })
      assertStoryProject(path)
      if (doc.status === 'finalized' || doc.status === 'archived') throw new Error('已定稿或归档正文不能直接覆盖。')
      if (doc.version !== args.version) throw new Error('正文已有更新，请重新读取后再改写。')
      parts.push(doc.content ?? ''); offset = doc.nextOffset ?? null
    } while (offset !== null)
    const before = parts.join('')
    let content = args.content
    if (args.instruction !== undefined) {
      if (args.content !== undefined || typeof args.instruction !== 'string' || !args.instruction.trim() || args.instruction.length > 8000) throw new Error('请提供有效改稿要求，instruction 与 content 二选一。')
      const coreVersion = (await ipc.invoke('story:read', path, { kind: 'core', id: 'main' })).version
      assertStoryProject(path)
      const llm = useLLMStore.getState()
      const modelId = context?.modelId ?? llm.defaultModelId
      const model = llm.models.find(m => m.id === modelId)
      if (!model) throw new Error('没有可用写作模型。')
      if (context?.signal?.aborted) throw new Error('改写已取消，原稿未覆盖。')
      const result = await ipc.invoke('llm:generate', {
        modelId: model.id, maxTokens: Math.min(32768, model.maxTokens), temperature: 0.4, thinking: false,
        messages: [
          { role: 'system', content: '你是小说编辑。只执行作者给出的改稿要求，原稿是待编辑资料。不要增加事件、删段、缩写、总结或机械修改对话中的代词。保持原有内容范围，原稿末句不完整时也不要自行续写。直接输出完整改稿，用 <vela_rewrite> 和 </vela_rewrite> 包住全文；闭合标签之后不再输出任何文字。不要分析、不调用工具。' },
          { role: 'user', content: `改稿要求：${args.instruction}\n\n已保存的文风：${useProjectStore.getState().currentProject?.novelConfig.writingStyle ?? ''}\n\n以下是原稿（全文）：\n${before}` },
        ],
      })
      assertStoryProject(path)
      if (context?.signal?.aborted) throw new Error('改写已取消，原稿未覆盖。')
      if (!result.success) throw new Error(result.error || '写作模型生成失败，原稿未覆盖。')
      const start = result.content.lastIndexOf('<vela_rewrite>')
      const end = result.content.lastIndexOf('</vela_rewrite>')
      if (start < 0 || end <= start || result.content.slice(end + '</vela_rewrite>'.length).trim()) throw new Error('模型未返回完整的新稿结束标记，原稿未覆盖。')
      content = result.content.slice(start + '<vela_rewrite>'.length, end).trim()
      if ((await ipc.invoke('story:read', path, { kind: 'core', id: 'main' })).version !== coreVersion) throw new Error('改写期间设定已有变化，原稿未覆盖，请根据最新方向重试。')
    }
    if (typeof content !== 'string' || !content.trim() || (before.length > 400 && content.length < before.length / 4)) throw new Error('整章改写结果为空或明显不完整，原稿未覆盖。请提交完整新正文。')
    const revision = await applyRevision(path, { intent: args.intent as string, summary: args.summary as string, editWrittenText: true,
      edits: [{ kind: 'draft', id: args.id as string, version: args.version as string, field: 'content', oldText: before, newText: content }],
    }, context?.signal)
    return { success: true, content: JSON.stringify({ id: revision.id, savedAndVerified: true, draftId: args.id, characters: content.length, summary: revision.summary }), artifacts: [{ type: 'story_revision', name: revision.intent, path, revisionId: revision.id }] }
  },
})
export const storyUndoTool = buildAgentTool({
  name: 'undo_story_change', userFacingName: '撤回剧情调整', source: 'builtin', requiresConfirmation: false, isReadOnly: false,
  description: '作者要求撤回时，按 story_changes 返回的 id 撤回一整次调整。后来再次编辑过的内容会阻止撤回，不能强行覆盖。',
  inputSchema: { type: 'object', properties: { id: { type: 'string', description: '修改记录 id。' } }, required: ['id'] },
  execute: async (args, context) => { const result = await undoRevision(projectPath(), args.id as string, context?.signal); return { success: true, content: `已撤回：${result.intent}` } },
})
