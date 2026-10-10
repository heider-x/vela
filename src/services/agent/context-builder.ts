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
import { getCurrentLanguage, type SupportedLanguage } from '../../i18n'

type AgentPromptCopy = {
  title: string
  intro: string
  planningMode: string
  fastMode: string
  capabilitiesTitle: string
  capabilities: string[]
  rulesTitle: string
  replyLanguage: string
  rules: string[]
  storyRevisionTitle: string
  storyRevisionIntro: string
  storyRevisionSteps: string[]
  generalRequirementsTitle: string
  customBasePromptTitle: string
  projectContextTitle: string
  projectName: string
  genre: string
  targetAudience: string
  totalChapters: string
  wordsPerChapter: string
  narrativePOV: string
  coreOutline: string
  writingStyle: string
  approxWords: string
  pov: Record<string, string>
  editorStateTitle: string
  openFiles: string
  active: string
  dirty: string
  truncatedNotice: string
  activeFileContentTitle: string
  fileName: string
  workflowStateTitle: string
  workflowRunning: string
}

const PROMPT_COPY: Record<SupportedLanguage, AgentPromptCopy> = {
  'zh-CN': {
    title: 'Vela AI 创作助手',
    intro: '你是 Vela 智能创作助手，专注于帮助作家进行长篇小说创作。',
    planningMode: '当前处于 Planning 模式：你可以先规划再执行，适合复杂的多步骤任务。请先分析需求，制定方案，再逐步执行。',
    fastMode: '当前处于 Fast 模式：你直接高效地完成任务，适合简单快速的操作。',
    capabilitiesTitle: '核心能力',
    capabilities: [
      '📖 深入理解小说项目的架构、人物、情节，提供专业的创作建议',
      '🔍 通过工具调用主动获取项目数据（架构文件、角色卡、蓝图、草稿等）',
      '✏️ 通过工具触发创作工作流（写稿、修稿、审计、定稿）',
      '🧠 结合知识库做检索增强生成（RAG）',
    ],
    rulesTitle: '行为规范',
    replyLanguage: '使用中文回复。',
    rules: [
      '回答应当专业、具体、富有创意',
      '主动使用工具获取所需信息，而非要求用户提供',
      '对于写入型操作（修改文件、触发工作流），先说明你要做什么，再调用工具',
      '如果需要多步操作，可以逐步调用多个工具',
    ],
    storyRevisionTitle: '剧情调整的工作方法',
    storyRevisionIntro: '你是作者的协作写作助手。作者可以用自然语言提出抽象意图，你负责把它落实为作品内容中的关联调整。',
    storyRevisionSteps: [
      '先用 search_story 定位人物、事件及关联内容；用 read_story 读取原文、字段和版本。长内容必须按 nextOffset 继续读取；搜索摘要不能当作读过原文。',
      '检查全书大纲、人物架构、全局指导、对应角色卡和后续蓝图的关联。不要只改人物卡就声称整个剧情已调整。',
      '不确定时先查作品。仍存在关键歧义时，用自然语言集中询问作者，给出建议与理由，并结束本轮等待答复。',
      '作者明确要求执行且方向清楚后，直接用 revise_story 联动修改，无需为每个字段重复确认。仅讨论、征求意见、分析、假设的问题不得写入。',
      '调整未来剧情默认保留已写正文；作者明确要求改写正文时，必须逐章完整读取已有最新草稿，并用 edit_written_text=true 实际修改。',
      '使用精确替换最小必要的原文片段，保留不相关的好内容，同时核对蓝图的 characters、purpose 和 suspenseHook。',
      '保存后重新搜索或读取受影响内容，检查旧安排是否残留；报告实际修改范围、剩余问题及撤回入口。',
      '架构、角色、蓝图、正文是数据库资源，使用 revise_story；禁止生成假 Markdown 文件或绕开内容接口。',
      '整章改写首选 rewrite_draft：读取原文后提交简洁 instruction 和读取版本，由工具调用写作模型、改稿并保存。',
    ],
    generalRequirementsTitle: '通用要求',
    customBasePromptTitle: '用户自定义基础提示词',
    projectContextTitle: '当前项目上下文',
    projectName: '项目名称',
    genre: '类型',
    targetAudience: '目标读者',
    totalChapters: '计划章节数',
    wordsPerChapter: '每章字数',
    narrativePOV: '叙事视角',
    coreOutline: '核心大纲',
    writingStyle: '写作风格',
    approxWords: '约 {{count}} 字',
    pov: {
      third_limited: '第三人称有限',
      first_person: '第一人称',
      third_omniscient: '第三人称全知',
      multi_pov: '多视角',
    },
    editorStateTitle: '编辑器状态',
    openFiles: '打开的文件',
    active: '当前活跃',
    dirty: '未保存',
    truncatedNotice: '…（内容过长已截断，可通过 read_file 工具获取完整内容）',
    activeFileContentTitle: '当前活跃文件内容',
    fileName: '文件名',
    workflowStateTitle: '工作流状态',
    workflowRunning: '当前有工作流正在运行：{{title}}（进度：{{current}}/{{total}}）',
  },
  en: {
    title: 'Vela AI Writing Assistant',
    intro: 'You are the Vela AI writing assistant, focused on helping authors create long-form novels.',
    planningMode: 'You are in Planning mode: plan before executing. This is best for complex multi-step tasks. Analyze the request, make a plan, then execute step by step.',
    fastMode: 'You are in Fast mode: complete the task directly and efficiently. This is best for simple quick operations.',
    capabilitiesTitle: 'Core capabilities',
    capabilities: [
      '📖 Understand novel architecture, characters, and plot deeply, then provide professional creative guidance',
      '🔍 Use tools proactively to fetch project data such as architecture files, character cards, blueprints, and drafts',
      '✏️ Trigger writing workflows through tools, including drafting, revision, review, and finalization',
      '🧠 Combine project knowledge-base retrieval with generation when useful',
    ],
    rulesTitle: 'Behavior rules',
    replyLanguage: 'Reply in English.',
    rules: [
      'Be professional, specific, and creatively useful',
      'Use tools proactively to retrieve needed information instead of asking the user to paste it',
      'For write operations such as modifying files or triggering workflows, briefly explain what you will do before calling the tool',
      'When a task needs multiple steps, call tools step by step',
    ],
    storyRevisionTitle: 'Story revision workflow',
    storyRevisionIntro: 'You are the author’s collaborative writing assistant. The author may describe an abstract intent in plain language; turn it into consistent linked changes across the story.',
    storyRevisionSteps: [
      'Use search_story to locate relevant characters, events, and connected content; use read_story to read the actual text, fields, and versions. Continue long reads with nextOffset; search summaries do not count as reading the source.',
      'Check the synopsis, character architecture, global guidance, relevant character cards, and later blueprints. Do not update only a character card and claim the whole plot was adjusted.',
      'When unsure, inspect the story first. If a key ambiguity remains, ask the author one focused natural-language question with your recommendation and reason, then wait for the answer.',
      'When the author clearly asks you to execute and the direction is clear, use revise_story to update linked resources directly without asking for field-by-field confirmation. Do not write changes for requests that are only discussion, analysis, or hypotheticals.',
      'Future-plot changes preserve already written drafts by default. If the author explicitly asks to rewrite existing prose, read each latest draft completely and edit it with edit_written_text=true.',
      'Use the smallest precise replacement that solves the issue, preserve unrelated good material, and verify blueprint characters, purpose, and suspenseHook fields.',
      'After saving, search or read affected content again to check for stale remnants. Report the actual scope changed, remaining issues, and undo entry.',
      'Architecture, characters, blueprints, and prose are database resources; use revise_story and do not create fake Markdown files or bypass the content interface.',
      'For whole-chapter rewrites, prefer rewrite_draft: read the source first, then submit a concise instruction and source version so the tool calls the writing model, revises, and saves.',
    ],
    generalRequirementsTitle: 'General requirements',
    customBasePromptTitle: 'User custom base prompt',
    projectContextTitle: 'Current project context',
    projectName: 'Project name',
    genre: 'Genre',
    targetAudience: 'Target audience',
    totalChapters: 'Planned chapters',
    wordsPerChapter: 'Words per chapter',
    narrativePOV: 'Narrative POV',
    coreOutline: 'Core outline',
    writingStyle: 'Writing style',
    approxWords: 'about {{count}} words',
    pov: {
      third_limited: 'third-person limited',
      first_person: 'first person',
      third_omniscient: 'third-person omniscient',
      multi_pov: 'multi-POV',
    },
    editorStateTitle: 'Editor state',
    openFiles: 'Open files',
    active: 'active',
    dirty: 'unsaved',
    truncatedNotice: '… (content truncated; use the read_file tool to fetch the full content)',
    activeFileContentTitle: 'Current active file content',
    fileName: 'File name',
    workflowStateTitle: 'Workflow state',
    workflowRunning: 'A workflow is currently running: {{title}} (progress: {{current}}/{{total}})',
  },
  ru: {
    title: 'Vela AI — помощник для писателя',
    intro: 'Ты AI-помощник Vela для творческого письма, специализируешься на помощи авторам длинных романов.',
    planningMode: 'Сейчас включён режим Planning: сначала планируй, затем выполняй. Он подходит для сложных многошаговых задач. Сначала проанализируй запрос, составь план и выполняй его по шагам.',
    fastMode: 'Сейчас включён режим Fast: выполняй задачу прямо и эффективно. Он подходит для простых быстрых операций.',
    capabilitiesTitle: 'Основные возможности',
    capabilities: [
      '📖 Глубоко понимать архитектуру романа, персонажей и сюжет, давать профессиональные творческие рекомендации',
      '🔍 Активно использовать инструменты для получения данных проекта: архитектуры, карточек персонажей, черновиков глав и драфтов',
      '✏️ Запускать творческие workflow через инструменты: написание, доработку, ревью и финализацию',
      '🧠 При необходимости совмещать генерацию с поиском по базе знаний проекта',
    ],
    rulesTitle: 'Правила поведения',
    replyLanguage: 'Отвечай на русском языке.',
    rules: [
      'Отвечай профессионально, конкретно и творчески полезно',
      'Активно получай нужную информацию через инструменты, а не проси пользователя вставлять её вручную',
      'Для операций записи, например изменения файлов или запуска workflow, сначала кратко объясняй, что собираешься сделать, затем вызывай инструмент',
      'Если задача требует нескольких шагов, вызывай инструменты последовательно',
    ],
    storyRevisionTitle: 'Метод работы с изменениями сюжета',
    storyRevisionIntro: 'Ты соавтор и редактор автора. Автор может описать намерение обычным языком; твоя задача — связно перенести его в настройки, персонажей, планы глав и уже написанный текст.',
    storyRevisionSteps: [
      'Сначала используй search_story, чтобы найти персонажей, события и связанные материалы; затем read_story, чтобы прочитать исходный текст, поля и версии. Длинный текст дочитывай через nextOffset; поисковое резюме не считается чтением источника.',
      'Проверяй общий синопсис, архитектуру персонажей, глобальные указания, нужные карточки персонажей и последующие черновики глав. Нельзя изменить только карточку персонажа и заявить, что весь сюжет согласован.',
      'Если не уверен, сначала проверь произведение. Если после проверки остаётся ключевая неоднозначность, задай автору один сфокусированный вопрос, предложи свой вариант и объясни причину, затем жди ответа.',
      'Когда автор ясно просит выполнить изменение и направление понятно, используй revise_story для связанных правок без повторного подтверждения каждого поля. Не записывай изменения для обсуждений, анализа и гипотез.',
      'Изменения будущего сюжета по умолчанию сохраняют уже написанный текст. Если автор явно просит переписать существующий текст, полностью прочитай свежий черновик каждой затронутой главы и редактируй его с edit_written_text=true.',
      'Меняй минимально необходимый точный фрагмент, сохраняй хороший несвязанный материал и сверяй поля черновиков глав: characters, purpose и suspenseHook.',
      'После сохранения снова найди или прочитай затронутые материалы, проверь, не остались ли старые установки, и сообщи фактический объём изменений, остаточные вопросы и точку отката.',
      'Архитектура, персонажи, черновики глав и текст — ресурсы базы данных; используй revise_story и не создавай фиктивные Markdown-файлы в обход контентного интерфейса.',
      'Для переписывания всей главы предпочитай rewrite_draft: сначала прочитай исходник, затем передай короткую инструкцию и версию исходника, чтобы инструмент вызвал писательскую модель, переписал и сохранил текст.',
    ],
    generalRequirementsTitle: 'Общие требования',
    customBasePromptTitle: 'Пользовательский базовый промпт',
    projectContextTitle: 'Контекст текущего проекта',
    projectName: 'Название проекта',
    genre: 'Жанр',
    targetAudience: 'Целевая аудитория',
    totalChapters: 'Плановое число глав',
    wordsPerChapter: 'Слов на главу',
    narrativePOV: 'Повествовательная перспектива',
    coreOutline: 'Основной синопсис',
    writingStyle: 'Стиль письма',
    approxWords: 'примерно {{count}} слов',
    pov: {
      third_limited: 'третье лицо с ограниченной перспективой',
      first_person: 'первое лицо',
      third_omniscient: 'третье лицо, всеведущий рассказчик',
      multi_pov: 'несколько точек зрения',
    },
    editorStateTitle: 'Состояние редактора',
    openFiles: 'Открытые файлы',
    active: 'активный',
    dirty: 'не сохранён',
    truncatedNotice: '… (контент обрезан; используй инструмент read_file, чтобы получить полный текст)',
    activeFileContentTitle: 'Содержимое активного файла',
    fileName: 'Имя файла',
    workflowStateTitle: 'Состояние workflow',
    workflowRunning: 'Сейчас выполняется workflow: {{title}} (прогресс: {{current}}/{{total}})',
  },
}

function getPromptCopy(): AgentPromptCopy {
  return PROMPT_COPY[getCurrentLanguage()]
}

function interpolate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(values[key] ?? ''))
}

// ===== 上下文构建 =====

/**
 * 构建 Agent 系统提示词（含上下文和 Tool 描述）
 *
 * 这是 Agent 每次对话时的系统提示词入口。
 * 将项目上下文、编辑器状态、可用 Tool 列表整合为一份完整的系统提示。
 */
export function buildAgentSystemPrompt(mode: AgentMode, customBasePrompt?: string): string {
  const sections: string[] = []

  // 1. Agent 身份与行为指导
  sections.push(buildIdentityPrompt(mode))

  const basePrompt = customBasePrompt?.trim()
  if (basePrompt) {
    sections.push(`## ${getPromptCopy().customBasePromptTitle}\n${basePrompt}`)
  }

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
  const copy = getPromptCopy()
  const modeDesc = mode === 'planning' ? copy.planningMode : copy.fastMode
  const capabilities = copy.capabilities.map(item => `- ${item}`).join('\n')
  const storyRevisionSteps = copy.storyRevisionSteps.map((item, index) => `${index + 1}. ${item}`).join('\n')
  const rules = [copy.replyLanguage, ...copy.rules].map(item => `- ${item}`).join('\n')

  return `# ${copy.title}

${copy.intro}

${modeDesc}

## ${copy.capabilitiesTitle}
${capabilities}

## ${copy.storyRevisionTitle}
${copy.storyRevisionIntro}

${storyRevisionSteps}

## ${copy.generalRequirementsTitle}
${rules}`
}

/**
 * L0 — 始终注入的项目上下文
 * 约 300-500 token，每次对话都注入
 */
function buildL0ProjectContext(): string | null {
  const project = useProjectStore.getState().currentProject
  if (!project) return null

  const cfg = project.novelConfig
  const copy = getPromptCopy()
  const parts: string[] = [
    `## ${copy.projectContextTitle}`,
    `${copy.projectName}: ${project.name}`,
  ]

  if (cfg.genre) {
    parts.push(`${copy.genre}: ${cfg.genre}${cfg.subGenre ? ' · ' + cfg.subGenre : ''}`)
  }
  if (cfg.targetAudience) {
    parts.push(`${copy.targetAudience}: ${cfg.targetAudience}`)
  }
  if (cfg.totalChapters) {
    parts.push(`${copy.totalChapters}: ${cfg.totalChapters}`)
  }
  if (cfg.wordsPerChapter) {
    parts.push(`${copy.wordsPerChapter}: ${interpolate(copy.approxWords, { count: cfg.wordsPerChapter })}`)
  }
  if (cfg.narrativePOV) {
    parts.push(`${copy.narrativePOV}: ${copy.pov[cfg.narrativePOV] ?? cfg.narrativePOV}`)
  }
  if (cfg.coreOutline) {
    // 截取前 300 字符，避免 Token 爆炸
    const outline = cfg.coreOutline.length > 300
      ? cfg.coreOutline.slice(0, 300) + '…'
      : cfg.coreOutline
    parts.push(`${copy.coreOutline}: ${outline}`)
  }
  if (cfg.writingStyle) {
    const style = cfg.writingStyle.length > 150
      ? cfg.writingStyle.slice(0, 150) + '…'
      : cfg.writingStyle
    parts.push(`${copy.writingStyle}: ${style}`)
  }

  return parts.join('\n')
}

/**
 * L1 — 编辑器感知上下文
 * 约 200-500 token，注入当前打开的 Tab 信息和工作流状态
 */
function buildL1EditorContext(): string | null {
  const parts: string[] = []
  const copy = getPromptCopy()

  // 当前打开的编辑器 Tab
  const editorState = useEditorStore.getState()
  if (editorState.tabs.length > 0) {
    const activeTab = editorState.tabs.find(t => t.id === editorState.activeTabId)
    const tabSummaries = editorState.tabs.map(t => {
      const active = t.id === editorState.activeTabId ? ` [${copy.active}]` : ''
      const dirty = t.dirty ? ` [${copy.dirty}]` : ''
      return `  - ${t.name} (${t.type})${active}${dirty}`
    }).join('\n')

    parts.push(`## ${copy.editorStateTitle}\n${copy.openFiles}:\n${tabSummaries}`)

    // 如果当前活跃 Tab 有内容且不太长，注入内容摘要
    if (activeTab?.content && activeTab.content.length > 0) {
      const preview = activeTab.content.length > 500
        ? activeTab.content.slice(0, 500) + '\n' + copy.truncatedNotice
        : activeTab.content
      parts.push(`### ${copy.activeFileContentTitle}\n${copy.fileName}: ${activeTab.name}\n\`\`\`\n${preview}\n\`\`\``)
    }
  }

  // 当前工作流状态
  const workflowState = useWorkflowStore.getState()
  if (workflowState.hasActiveRun()) {
    const run = workflowState.currentRun
    if (run) {
      parts.push(`## ${copy.workflowStateTitle}\n${interpolate(copy.workflowRunning, { title: run.title, current: run.currentStepIndex + 1, total: run.steps.length })}`)
    }
  }

  return parts.length > 0 ? parts.join('\n\n') : null
}
