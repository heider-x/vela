/**
 * Vela 内置 Prompt 模板库
 *
 * 包含全流程创作所需的全部提示词模板
 * 支持三级覆盖：内置 → 全局自定义 → 项目级覆盖
 *
 * 架构生成 Prompt 来源于 AI_NovelGenerator 项目（经专业优化）
 */

import i18n from '../i18n'

export interface PromptTemplate {
  /** 模板唯一标识 */
  key: string
  /** 显示名称（i18n key: promptTemplates.{key}.name） */
  name: string
  /** 用途说明（i18n key: promptTemplates.{key}.description） */
  description: string
  /** 模板内容（支持 {{变量}} 插值）— 中文默认 */
  content: string
  /** 不可编辑的系统约束（输出格式、JSON schema 等），渲染时自动追加到 content 末尾 */
  systemSuffix?: string
  /** LLM system message 角色定位（由模板统一定义，command 不再硬编码） */
  systemRole?: string
  /** 可用变量列表 */
  variables: Record<string, string>
  /** Localized content overrides keyed by locale */
  contentLocalized?: Record<string, string>
  /** Localized systemRole overrides */
  systemRoleLocalized?: Record<string, string>
  /** Localized systemSuffix overrides */
  systemSuffixLocalized?: Record<string, string>
}

/** 获取翻译后的模板名称 */
export function getPromptName(key: string): string {
  return i18n.t(`promptTemplates.${key}.name`, { ns: 'settings' })
}

/** 获取翻译后的模板描述 */
export function getPromptDescription(key: string): string {
  return i18n.t(`promptTemplates.${key}.description`, { ns: 'settings' })
}

/** Получить локализованное содержимое промпта */
export function getLocalizedContent(template: PromptTemplate): string {
  const lang = i18n.language
  return template.contentLocalized?.[lang] || template.contentLocalized?.[lang.split('-')[0]] || template.content
}

/** Получить локализованную системную роль */
export function getLocalizedSystemRole(template: PromptTemplate): string {
  const lang = i18n.language
  return template.systemRoleLocalized?.[lang] || template.systemRoleLocalized?.[lang.split('-')[0]] || template.systemRole || ''
}

/** Получить локализованный системный суффикс */
export function getLocalizedSystemSuffix(template: PromptTemplate): string {
  const lang = i18n.language
  return template.systemSuffixLocalized?.[lang] || template.systemSuffixLocalized?.[lang.split('-')[0]] || template.systemSuffix || ''
}

/** 允许用户自定义编辑的模板 Key 列表（其余为系统模板，不可编辑） */
export const EDITABLE_PROMPT_KEYS: string[] = [
  'generate_global_config',
  'premise',
  'character_dynamics',
  'world_building',
  'synopsis',
  'first_chapter_draft',
  'next_chapter_draft',
  'refine_chapter',
  'consistency_check',
  'analyze_writing_style',
  'refine_from_review',
]

/** 全部内置 Prompt 模板 */
export const BUILTIN_PROMPTS: PromptTemplate[] = [

  // ================================================================
  // AI 一键配置生成
  // ================================================================
  {
    key: 'generate_global_config',
    name: '全文配置生成',
    description: '根据用户一句话灵感，生成完整的小说配置 JSON',
    systemRole: '你是一位入行十年的顶尖网文主编与白金大神作家，擅长从一句话灵感中提炼完整的商业小说配置。',
    variables: {
      user_idea: '用户输入的灵感/想法',
      number_of_chapters: '计划总章数',
      word_number: '每章计划字数',
    },
    content: `基于作者提供的一句话点子或初步脑洞，请按照当今最成熟、最具商业霸榜潜力的网文核心结构，扩展并补全一部小说的全局爆款设定。

作者初步脑洞：
{{user_idea}}

小说规模（重要！请严格根据此参数设计节奏）：
- 计划总章数：{{number_of_chapters}} 章
- 每章字数：{{word_number}} 字
- 全书总字数约：{{number_of_chapters}} × {{word_number}} 字

【核心任务要求】
1. 深度挖掘商业价值：提取强烈的"爽点"、"情绪痛点"，构建极具张力的起承转合。
2. 专业化设定：应用"角色图谱"和"三维世界观"理念，杜绝假大空，所有设定必须为推动情节和产生直接冲突服务。
3. 契合市场：如果作者未指定基础类型，请推断一个最契合的爆火类型。
4. 节奏定制：globalGuidance 中的前/中/后期章节区间、小/中/大高潮频率，必须严格基于【{{number_of_chapters}} 章】的实际规模推算，禁止使用与实际章数不符的数字。
5. 智能推荐：根据类型和题材推荐最合适的故事结构和叙事视角。`,
    systemSuffix: `【输出格式限制】
- 必须以标准的 JSON 格式返回，确保匹配以下结构。

【JSON 字段结构】
{
    "genre": "主类型（玄幻/仙侠/都市/科幻/历史/悬疑/游戏/军事/奇幻/武侠/现实/其他）",
    "targetAudience": "受众目标（男频/女频/通用/短篇）",
    "subGenre": "细分子类型及核心标签（如：末日废土、苟道流、权谋、大女主逆袭）",
    "plotStructure": "故事结构（three_act=三幕结构 / heros_journey=英雄之旅 / save_the_cat=节拍表 / kishotenketsu=起承转合 / multi_thread=多线叙事 / freeform=自由结构，根据类型推荐最合适的）",
    "narrativePOV": "叙事视角（third_limited=第三人称有限视角 / first_person=第一人称 / third_omniscient=第三人称全知视角 / multi_pov=多视角轮换，根据类型推荐最合适的）",
    "coreOutline": "核心大纲（不少于150字，含：主角的致命危机/开局困境、必须完成的核心目标、终极大危机、主要爽点起伏）",
    "worldSetting": "独特的背景设定（物理维度、权力断层、核心资源争夺机制）",
    "goldenFinger": "核心卖点与金手指体系（获取方式、具体功能、进阶成长路径、副作用/限制）",
    "protagonistProfile": "主角人设档案（极具反差的性格弱点、表面伪装标签、核心驱动力：物质目标+深层灵魂渴望）",
    "globalGuidance": "全局写作指导与核心禁忌（严格基于{{number_of_chapters}}章规模：前/中/后期各占多少章、小/中/大高潮的具体章节频率、严禁触碰的毒点）",
    "writingStyle": "文风配置（不少于100字，涵盖：叙述节奏快慢与场景切换频率、描写密度偏好、对话风格与口语化程度、用词偏好古风/现代/专业术语、情感基调热血/冷峻/诙谐/沉重、标志性修辞手法与过渡技巧。请根据类型和受众推荐最匹配的写作风格）"
}`,
    contentLocalized: {
      en: `Based on the author's one-line idea or initial concept, please expand and complete a novel's global bestseller configuration following the most mature and commercially dominant web novel core structure.

Author's initial concept:
{{user_idea}}

Novel scale (IMPORTANT! Design pacing strictly according to these parameters):
- Planned total chapters: {{number_of_chapters}}
- Words per chapter: {{word_number}}
- Approximate total word count: {{number_of_chapters}} × {{word_number}} words

【Core Requirements】
1. Deep commercial value mining: Extract powerful "satisfaction points" and "emotional pain points" to build a compelling setup-development-twist-resolution arc.
2. Professional-grade settings: Apply "character graph" and "3D worldbuilding" principles. All settings must serve plot progression and direct conflict — no empty filler.
3. Market fit: If the author hasn't specified a base genre, infer the most commercially explosive type.
4. Pacing customization: The early/mid/late chapter ranges and minor/medium/major climax frequencies in globalGuidance must be strictly calculated based on the actual scale of [{{number_of_chapters}} chapters]. Do not use numbers that contradict the actual chapter count.
5. Smart recommendations: Recommend the most suitable story structure and narrative POV based on the genre and theme.`,
      ru: `Основываясь на одной идее или начальном наброске автора, пожалуйста, расширьте и дополньте глобальную конфигурацию романа-бестселлера, следуя самой зрелой и коммерчески доминирующей структуре веб-романа.

Начальная идея автора:
{{user_idea}}

Масштаб романа (ВАЖНО! Пacing проектируйте строго по этим параметрам):
- Плановое количество глав: {{number_of_chapters}}
- Слов в главе: {{word_number}}
- Примерная общая длина: {{number_of_chapters}} × {{word_number}} слов

【Основные требования】
1. Глубокая挖掘 коммерческой ценности: извлекайте мощные «точки удовлетворения» и «эмоциональные болевые точки» для построения захватывающей арки завязки-развития-кульминации-развязки.
2. Профессиональные настройки: применяйте принципы «карты персонажей» и «3D-мировоззрения». Все настройки должны служить продвижению сюжета и созданию прямых конфликтов — никакой пустой воды.
3. Соответствие рынку: если автор не указал базовый жанр, угадайте самый коммерчески взрывной тип.
4. Кастомизация темпа: диапазоны глав начальной/средней/финальной частей и частота малых/средних/крупных кульминаций в globalGuidance должны быть строго рассчитаны по фактическому масштабу [{{number_of_chapters}} глав]. Не используйте цифры, противорящие реальному количеству глав.
5. Умные рекомендации: рекомендуйте наиболее подходящую структуру故事 и повествовательную точку зрения на основе жанра и темы.`
    },
    systemRoleLocalized: {
      en: 'You are a top-tier web novel editor and platinum-selling author with ten years of industry experience, skilled at distilling a one-line idea into a complete commercial novel configuration.',
      ru: 'Вы — ведущий редактор веб-романов и платиновый автор с десятилетним опытом, искусно превращающий одну идею в полную коммерческую конфигурацию романа.'
    },
  },


  // ================================================================
  // 架构生成 — 四步流水线
  // ================================================================

  {
    key: 'premise',
    name: '故事前提',
    description: '故事架构第一步：提炼故事前提（Story Premise），浓缩全书的核心卖点与冲突链',
    systemRole: '你是一位顶尖的网络小说策划专家与故事架构师。',
    variables: {
      genre: '小说类型',
      sub_genre: '细分类型',
      topic: '核心主题/故事简介',
      target_audience: '目标受众',
      number_of_chapters: '总章数',
      word_number: '每章字数',
      core_setting: '世界观基盘设定',
      golden_finger: '核心金手指/卖点',
      protagonist_profile: '主角人设',
      global_guidance: '全局写作要求',
      step_guidance: '作者对本步骤的补充指导（可选）',
      reference_works: '参考作品（可选）',
    },
    content: `请提炼本书的故事前提（Story Premise）。这是一本【{{genre}}】（细分类别：{{sub_genre}}）小说。

【核心设定参数】
- 核心大纲：{{topic}}
- 目标受众：{{target_audience}}
- 预期篇幅：约{{number_of_chapters}}章（每章{{word_number}}字）
- 世界观基盘：{{core_setting}}
- 核心金手指/系统：{{golden_finger}}
- 主角核心人设：{{protagonist_profile}}
- 全局写作要求与禁忌：{{global_guidance}}

【生成任务】
请生成一份 300-500 字的结构化故事前提，严格按以下四个小节输出：

## 一句话前提（Logline）
用 30-50 字极度浓缩全书核心："当 [主角身份] 遭遇 [触发事件]，必须 [核心行动] 否则 [灾难后果]。"

## 核心冲突链
展开描述：主角的初始困境 → 打破平衡的触发事件 → 核心主线目标 → 主要阻碍势力。（约 100 字）

## 金手指定位
详细说明：金手指的获取方式 → 核心机制与功能 → 与世界观规则的交互点 → 进阶路线与限制/代价。（约 100-150 字）

## 悬念骨架
描述：显性冲突线（当前最大威胁）+ 隐藏主线暗示（终极悬念/深层真相）。（约 100 字）

【要求】
1. 金手指必须是推动情节的核心手段，要具体描述其独特机制，不要泛泛而谈。
2. 必须体现主角基于设定的核心欲望或执念。
3. 冲突链必须包含显性敌人与深层危机两个层次。
4. 严格避开全局写作要求与禁忌中的毒点。
5. 使用上述 Markdown 小节标题分隔，不要添加额外解释。

【参考作品风格（如有，调性与节奏可参考以下作品）】
{{reference_works}}`,
    systemSuffix: `★【作者对本步骤的额外指导（如有，最高优先级）】★：
{{step_guidance}}`,
    contentLocalized: {
      en: `Please distill the story premise for this novel. This is a [{{genre}}] novel (sub-genre: {{sub_genre}}).

【Core Setting Parameters】
- Core outline: {{topic}}
- Target audience: {{target_audience}}
- Expected length: approximately {{number_of_chapters}} chapters ({{word_number}} words each)
- Worldbuilding foundation: {{core_setting}}
- Golden finger / core selling point: {{golden_finger}}
- Protagonist profile: {{protagonist_profile}}
- Global writing requirements and prohibitions: {{global_guidance}}

【Generation Task】
Generate a 300–500 word structured story premise, strictly following these four sections:

## One-Line Premise (Logline)
Condense the entire novel's core in 30–50 words: "When [protagonist identity] encounters [triggering event], they must [core action] or else [catastrophic consequence]."

## Core Conflict Chain
Elaborate: protagonist's initial dilemma → the event that shatters equilibrium → core main-line objective → primary antagonistic forces. (~100 words)

## Golden Finger Positioning
Detail: how the golden finger is obtained → core mechanics and functions → interaction points with world rules → progression paths and limitations/costs. (~100–150 words)

## Suspense Skeleton
Describe: the overt conflict line (current biggest threat) + hidden main-line hints (ultimate mystery / deep truth). (~100 words)

【Requirements】
1. The golden finger must be a core plot-driving mechanism — describe its unique mechanics in detail, no vague hand-waving.
2. Must embody the protagonist's core desire or obsession derived from their setting.
3. The conflict chain must include both an overt enemy and a deeper crisis.
4. Strictly avoid any prohibited elements listed in global writing requirements.
5. Use the Markdown section headings above as separators; do not add extra commentary.

【Reference Works (if any — match tone and pacing)】
{{reference_works}}`,
      ru: `Пожалуйста, сформулируйте сюжетную посылку для этого романа. Это роман жанра [{{genre}}] (поджанр: {{sub_genre}}).

【Параметры основных настроек】
- Основной конспект: {{topic}}
- Целевая аудитория: {{target_audience}}
- Ожидаемый объём: примерно {{number_of_chapters}} глав (по {{word_number}} слов в каждой)
- Фундамент мироздания: {{core_setting}}
- Золотой палец / ключевая фишка: {{golden_finger}}
- Профиль главного героя: {{protagonist_profile}}
- Глобальные требования и запреты на написание: {{global_guidance}}

【Задание по генерации】
Создайте структурированную сюжетную посылку из 300–500 слов, строго следуя четырём разделам:

## Однострочная посылка (Логлайн)
Уместите ядро всего романа в 30–50 слов: «Когда [идентичность героя] сталкивается с [триггерным событием], он должен [ключевое действие], иначе [катастрофическое последствие].»

## Цепь основных конфликтов
Разверните: начальная дилемма героя → событие, разрушающее равновесие → основная главная цель → главные противостоящие силы. (~100 слов)

## Позиционирование золотого пальца
Детализируйте: способ получения золотого пальца → основные механики и функции → точки взаимодействия с правилами мира → пути развития и ограничения/цена. (~100–150 слов)

## Каркас интриги
Опишите: линия явного конфликта (текущая главная угроза) + скрытые подсказки основной линии (тайна финала / глубинная правда). (~100 слов)

【Требования】
1. Золотой палец должен быть ключевым двигателем сюжета — опишите его уникальные механики подробно, без абстрактных общих фраз.
2. Должно отражаться основное желание или одержимость героя, вытекающие из его сеттинга.
3. Цепь конфликтов должна включать как явного врага, так и более глубокую угрозу.
4. Строго избегайте любых запрещённых элементов из глобальных требований.
5. Используйте заголовки разделов выше как разделители; не добавляйте лишних комментариев.

【Эталонные произведения (если есть — ориентируйтесь на тон и ритм)】
{{reference_works}}`
    },
    systemRoleLocalized: {
      en: 'You are a top-tier web novel planning expert and story architect.',
      ru: 'Вы — ведущий эксперт по планированию веб-романов и архитектор сюжетов.'
    },
  },

  {
    key: 'character_dynamics',
    name: '角色图谱',
    description: '故事架构第二步：构建核心角色关系网与角色弧光',
    systemRole: '你是一位顶尖的网络小说策划专家与故事架构师。',
    variables: {
      premise: '故事前提',
      genre: '小说类型',
      protagonist_profile: '主角人设',
      golden_finger: '金手指体系',
      world_building: '世界观设定',
      number_of_chapters: '总章数',
      global_guidance: '全局写作要求',
      step_guidance: '作者对本步骤的补充指导（可选）',
      reference_works: '参考作品（可选）',
    },
    content: `请基于故事前提为本书塑造一个极具戏剧张力的核心角色图谱。

【参考参数】
- 小说类型：{{genre}}
- 故事前提：{{premise}}
- 主角预设档案：{{protagonist_profile}}
- 金手指体系：{{golden_finger}}
- 世界观背景：{{world_building}}
- 预期篇幅：约{{number_of_chapters}}章
- 全局写作要求与禁忌：{{global_guidance}}

【生成任务】
围绕主角，根据小说篇幅（{{number_of_chapters}}章）设计合理数量的核心角色（短篇3-4人，中长篇4-6人）。角色切忌脸谱化。请生成包含以下结构的角色图谱：

1. 【第一核心：主角】
- 表面追求与终极渴望（根据档案补全性格的明暗两面）
- 标志性外貌特征（衣着、气质、独特标志等）
- 金手指使用风格（基于「{{golden_finger}}」的具体机制，设计独特的使用习惯或战斗/升级策略）
- 灵魂软肋与蜕变预期（角色弧光起始点 → 终点）

2. 【核心角色阵营】
为每位角色提供：姓名/代号、身份背景、标志性外貌特征、与主角的关系张力、暗藏秘密。
角色设计原则（非固定模板，根据故事需要灵活配置）：
- 至少 1 位与主角有深度羁绊的盟友/伙伴（互补而非附庸）
- 至少 1 位与主角理念对立的竞争者/对手（有自己的正当动机）
- 可选：1 位隐藏变数/灰色角色（立场不定，可能带来反转）
- 可选：根据故事需要增加导师、阴谋家、势力代言人等

3. 【核心矛盾交织网】
简述所有角色如何因为世界观下的生存压力、资源争夺或信念冲突产生不可避免的碰撞。

【要求】
1. 主角必须严格符合主角档案基调，不可偏离。
2. 所有角色的设计必须贴合「{{genre}}」类型的读者期待。
3. 默认避免圣母、降智反派或纯工具人（除非作者明确要求）。
4. 仅返回角色图谱文本，不要任何客套话。

【参考作品风格（如有，调性与节奏可参考以下作品）】
{{reference_works}}`,
    systemSuffix: `★【作者对本步骤的额外指导（如有，最高优先级）】★：
{{step_guidance}}`,
    contentLocalized: {
      en: `Based on the story premise, create a highly dramatic core character map for this novel.

【Reference Parameters】
- Novel genre: {{genre}}
- Story premise: {{premise}}
- Protagonist profile: {{protagonist_profile}}
- Golden finger system: {{golden_finger}}
- Worldbuilding: {{world_building}}
- Expected length: approximately {{number_of_chapters}} chapters
- Global writing requirements: {{global_guidance}}

【Generation Task】
Design a reasonable number of core characters around the protagonist, proportional to the novel's length (3–4 for short stories, 4–6 for medium/long works). Characters must avoid being one-dimensional. Generate a character map with the following structure:

1. 【The Core: Protagonist】
- Surface desires vs. ultimate yearning (flesh out both light and dark sides of the personality)
- Signature physical traits (clothing, aura, distinctive marks, etc.)
- Golden finger usage style (based on the specific mechanics of "{{golden_finger}}", design unique usage habits or combat/leveling strategies)
- Soul vulnerability and transformation arc (starting point → endpoint)

2. 【Core Character Camp】
For each character provide: name/code, background, signature physical traits, tension in their relationship with the protagonist, hidden secrets.
Character design principles (flexible, not a rigid template — configure based on story needs):
- At least 1 ally/partner with deep bonds to the protagonist (complementary, not subordinate)
- At least 1 rival/opponent with opposing ideologies (who has their own legitimate motivations)
- Optional: 1 hidden wild card / morally grey character (unpredictable allegiance, potential for twists)
- Optional: add mentor, mastermind, faction spokesperson, etc. as the story requires

3. 【Core Conflict Web】
Briefly describe how all characters inevitably clash due to survival pressures, resource competition, or ideological conflict within the world.

【Requirements】
1. Protagonist must strictly match the protagonist profile's tone — no deviations.
2. All character designs must fit reader expectations for the "{{genre}}" genre.
3. By default avoid saintly sages, idiotic villains, or pure utility characters (unless the author explicitly requests them).
4. Return only the character map text — no pleasantries.

【Reference Works (if any)】
{{reference_works}}`,
      ru: `На основе сюжетной посылки создайте максимально драматичную карту ключевых персонажей для этого романа.

【Параметры для справки】
- Жанр романа: {{genre}}
- Сюжетная посылка: {{premise}}
- Профиль главного героя: {{protagonist_profile}}
- Система золотого пальца: {{golden_finger}}
- Мироздание: {{world_building}}
- Ожидаемый объём: примерно {{number_of_chapters}} глав
- Глобальные требования к написанию: {{global_guidance}}

【Задание по генерации】
Спроектируйте разумное количество ключевых персонажей вокруг героя, пропорциональное объёму романа (3–4 для коротких историй, 4–6 для средних/длинных). Персонажи должны избегать шаблонности. Создайте карту персонажей со следующей структурой:

1. 【Ядро: Главный герой】
- Поверхностные желания vs. глубинная тоска (раскройте обе стороны личности — светлую и тёмную)
- Характерные внешние черты (одежда, аура, уникальные приметы и т.д.)
- Стиль использования золотого пальца (на основе конкретных механик «{{golden_finger}}» придумайте уникальные привычки использования или боевую/прогрессирующую стратегию)
- Душевная уязвимость и арка трансформации (начальная точка → конечная)

2. 【Лагерь ключевых персонажей】
Для каждого персонажа укажите: имя/код, предысторию, характерные внешние черты, напряжённость в отношениях с героем, скрытые тайны.
Принципы проектирования (гибкие, а не шаблон — настраивайте по потребностям истории):
- Как минимум 1 союзник/партнёр с глубокой связью с героем (дополняющий, а не подчинённый)
- Как минимум 1 соперник/противник с противоположными идеологиями (имеющий свои обоснованные мотивы)
- По желанию: 1 скрытый wild card / морально серый персонаж (непредсказуемая позиция, потенциал для переворотов)
- По желанию: добавьте наставника, интригана, представителя фракции и т.д. по необходимости

3. 【Сеть основных конфликтов】
Кратко опишите, как все персонажи неизбежно сталкиваются из-за давления выживания, конкуренции за ресурсы или идеологических противоречий в мире.

【Требования】
1. Главный герой должен строго соответствовать тону профиля — никаких отклонений.
2. Все персонажи должны соответствовать ожиданиям читателей жанра «{{genre}}».
3. По умолчанию избегайте безоговорочно святых, тупых злодеев или чисто функциональных персонажей (если автор явно не попросил).
4. Возвращайте только текст карты персонажей — никаких вступлений.

【Эталонные произведения (если есть)】
{{reference_works}}`
    },
    systemRoleLocalized: {
      en: 'You are a top-tier web novel planning expert and story architect.',
      ru: 'Вы — ведущий эксперт по планированию веб-романов и архитектор сюжетов.'
    },
  },

  {
    key: 'world_building',
    name: '世界观构建',
    description: '故事架构第三步：构建自带冲突引擎的世界观矩阵',
    systemRole: '你是一位顶尖的网络小说策划专家与故事架构师。',
    variables: {
      premise: '故事前提',
      genre: '小说类型',
      core_setting: '世界观基盘',
      golden_finger: '金手指体系',
      protagonist_profile: '主角人设',
      global_guidance: '全局写作要求',
      step_guidance: '作者对本步骤的补充指导（可选）',
    },
    content: `请将基础设定转化为能直接引发冲突的"剧情游乐场"。

【参考参数】
- 小说类型：{{genre}}
- 故事前提：{{premise}}
- 核心世界观设定：{{core_setting}}
- 金手指体系：{{golden_finger}}
- 主角定位：{{protagonist_profile}}
- 全局写作要求与禁忌：{{global_guidance}}

【生成任务】
请基于核心世界观，根据「{{genre}}」类型的特点，构建以下三个维度的世界观设定。每个设定都必须"自带冲突点"，能直接驱动情节。

1. 【核心规则与体系漏洞】
- 本世界运转的核心规则是什么？（根据类型可以是：修炼体系、科技等级、社会制度、超自然法则等）
- 规则中的绝对优势是什么？主角的金手指「{{golden_finger}}」如何在这套规则下占据独特的非对称优势？

2. 【阶层断层与资源战场】
- 这个世界里存在哪些不可调和的势力/阶层/阵营对立？
- 最稀缺的核心资源是什么？它是如何分配的？主角处于什么位置，需要向谁争夺？

3. 【隐喻与深层危机】
- 世界背后的终极灾变或最大谜团是什么？
- 有什么流传的禁忌、历史谎言或被掩盖的真相，恰好与主角的命运产生交汇？

【要求】
1. 所有设定必须围绕「{{genre}}」题材的核心看点，不要写无法融入正文的废话设定。
2. 金手指与世界规则的交互必须具体、可操作，避免泛泛而谈。
3. 严格遵循全局写作要求与禁忌，禁止崩坏。
4. 仅返回世界观设定文本，不要生成任何无关代码或解释。

`,
    systemSuffix: `★【作者对本步骤的额外指导（如有，最高优先级）】★：
{{step_guidance}}`,
    contentLocalized: {
      en: `Transform the base settings into a "plot playground" that directly generates conflict.

【Reference Parameters】
- Novel genre: {{genre}}
- Story premise: {{premise}}
- Core worldbuilding: {{core_setting}}
- Golden finger system: {{golden_finger}}
- Protagonist positioning: {{protagonist_profile}}
- Global writing requirements: {{global_guidance}}

【Generation Task】
Based on the core worldbuilding and the characteristics of the "{{genre}}" genre, construct world settings across the following three dimensions. Every element must "carry built-in conflict points" that directly drive the plot.

1. 【Core Rules & System Exploits】
- What are the fundamental rules governing this world? (Depending on genre: cultivation system, technology tiers, social structure, supernatural laws, etc.)
- What is the absolute advantage within these rules? How does the protagonist's golden finger "{{golden_finger}}" create a unique asymmetric edge within this system?

2. 【Class Fractures & Resource Battlegrounds】
- What irreconcilable faction/class/factional oppositions exist in this world?
- What is the scarcest core resource? How is it distributed? Where does the protagonist stand, and who must they compete against?

3. 【Metaphor & Hidden Crisis】
- What is the ultimate catastrophe or greatest mystery behind this world?
- Are there forbidden knowledge, historical lies, or suppressed truths that happen to intersect with the protagonist's destiny?

【Requirements】
1. All settings must revolve around the core appeal of the "{{genre}}" genre — no empty settings that can't be woven into the narrative.
2. The interaction between golden finger and world rules must be specific and actionable — no vague generalities.
3. Strictly follow global writing requirements and prohibitions.
4. Return only the worldbuilding text — no irrelevant code or explanations.`,
      ru: `Преобразуйте базовые настройки в «сюжетную площадку», непосредственно порождающую конфликты.

【Параметры для справки】
- Жанр романа: {{genre}}
- Сюжетная посылка: {{premise}}
- Основное мироздание: {{core_setting}}
- Система золотого пальца: {{golden_finger}}
- Позиционирование героя: {{protagonist_profile}}
- Глобальные требования к написанию: {{global_guidance}}

【Задание по генерации】
На основе основного мироздания и характеристик жанра «{{genre}}» постройте настройки мира по трём измерениям. Каждый элемент должен «нести встроенные точки конфликта», непосредственно движущие сюжет.

1. 【Основные правила и уязвимости системы】
- Каковы фундаментальные правила, управляющие этим миром? (В зависимости от жанра: система культивации, уровни технологии, социальная структура, сверхъестественные законы и т.д.)
- Какое абсолютное преимущество существует в рамках этих правил? Как золотой палец героя «{{golden_finger}}» создаёт уникальное асимметричное преимущество в этой системе?

2. 【Классовые разломы и ресурсные арены】
- Какие непримиримые противостояния фракций/классов/лагерей существуют в этом мире?
- Какой ресурс является самым дефицитным? Как он распределяется? Где находится герой и с кем ему приходится конкурировать?

3. 【Метафора и скрытый кризис】
- Какова终极ная катастрофа или величайшая тайна, стоящая за этим миром?
- Существуют ли запретные знания, историческая ложь или скрытая правда, которая пересекается с судьбой героя?

【Требования】
1. Все настройки должны вращаться вокруг ключевой привлекательности жанра «{{genre}}» — никаких пустых настроек, которые нельзя вплести в повествование.
2. Взаимодействие золотого пальца и правил мира должно быть конкретным и применимым — никаких абстрактных общих фраз.
3. Строго следуйте глобальным требованиям и запретам на написание.
4. Возвращайте только текст мироздания — никакого лишнего кода или пояснений.`
    },
    systemRoleLocalized: {
      en: 'You are a top-tier web novel planning expert and story architect.',
      ru: 'Вы — ведущий эксперт по планированию веб-романов и архитектор сюжетов.'
    },
  },

  {
    key: 'synopsis',
    name: '情节大纲',
    description: '故事架构第四步：整合所有碎片，按用户选择的故事结构模式生成情节大纲',
    systemRole: '你是一位顶尖的网络小说策划专家与故事架构师。',
    variables: {
      premise: '故事前提',
      character_dynamics: '角色图谱',
      world_building: '世界观',
      genre: '小说类型',
      number_of_chapters: '总章数',
      word_number: '每章字数',
      plot_structure_guide: '故事结构详细指导（由系统根据用户选择的结构模式动态注入）',
      narrative_pov: '叙事视角描述',
      global_guidance: '全局写作要求',
      step_guidance: '作者对本步骤的补充指导（可选）',
    },
    content: `请将前序生成的所有碎片整合为全书的情节大纲。

【核心资产】
- 小说类型：{{genre}}
- 叙事视角：{{narrative_pov}}
- 故事前提：{{premise}}
- 角色图谱：{{character_dynamics}}
- 世界观矩阵：{{world_building}}
- 全局写作要求与禁忌：{{global_guidance}}

【篇幅参数（极其重要！结构节点必须严格基于此）】
- 计划总章数：{{number_of_chapters}} 章
- 每章字数：{{word_number}} 字
- 全书总字数约：{{number_of_chapters}} × {{word_number}} 字

【故事结构模式——严格按以下结构组织大纲】
{{plot_structure_guide}}

【生成任务】
严密推演涵盖全书的情节大纲。写"结构拐点"而非细纲。请根据「{{genre}}」类型的核心看点调整节奏策略。

【要求】
1. 结构节点的章节区间必须基于【{{number_of_chapters}}章】的实际规模标注具体范围，禁止使用与实际章数不符的数字。
2. 每个结构节点都要提到"具体会发生什么事"，不能泛泛而谈。
3. 节奏策略要匹配「{{genre}}」类型（如爽文侧重打脸与升级节奏，悬疑侧重线索与反转，言情侧重情感与误会）。
4. 叙事视角为「{{narrative_pov}}」，大纲设计时需考虑视角限制对信息揭露、悬念制造的影响。
5. 绝不能触碰全局写作要求与禁忌中的毒点。
6. 仅返回情节大纲纯文本，禁止一切废话或旁白。

`,
    systemSuffix: `★【作者对本步骤的额外指导（如有，最高优先级）】★：
{{step_guidance}}`,
    contentLocalized: {
      en: `Integrate all prior outputs into a complete plot synopsis for the entire novel.

【Core Assets】
- Novel genre: {{genre}}
- Narrative POV: {{narrative_pov}}
- Story premise: {{premise}}
- Character dynamics: {{character_dynamics}}
- Worldbuilding matrix: {{world_building}}
- Global writing requirements: {{global_guidance}}

【Scale Parameters (CRITICAL! Structural beats must be based on these)】
- Planned total chapters: {{number_of_chapters}}
- Words per chapter: {{word_number}}
- Approximate total word count: {{number_of_chapters}} × {{word_number}} words

【Story Structure Model — organize the outline strictly according to this structure】
{{plot_structure_guide}}

【Generation Task】
Rigorously derive a plot synopsis covering the entire novel. Write "structural turning points," not a detailed scene-by-scene outline. Adjust pacing strategy based on the core appeal of the "{{genre}}" genre.

【Requirements】
1. Chapter ranges for structural beats must be labeled with specific ranges based on the actual scale of [{{number_of_chapters}} chapters]. Do not use numbers that contradict the actual chapter count.
2. Each structural beat must specify "what exactly will happen" — no vague generalities.
3. Pacing strategy must match the "{{genre}}" genre (e.g., power fantasy focuses on face-slapping and leveling rhythm; mystery focuses on clues and reversals; romance focuses on emotion and misunderstandings).
4. The narrative POV is "{{narrative_pov}}" — the outline design must account for how POV limitations affect information reveal and suspense creation.
5. Never violate any prohibitions listed in global writing requirements.
6. Return only the plot synopsis as plain text — no filler or narration.`,
      ru: `Объедините все предыдущие выходы в полный сюжетный синопсис на весь роман.

【Основные активы】
- Жанр романа: {{genre}}
- Точка зрения повествования: {{narrative_pov}}
- Сюжетная посылка: {{premise}}
- Динамика персонажей: {{character_dynamics}}
- Матрица мироздания: {{world_building}}
- Глобальные требования к написанию: {{global_guidance}}

【Параметры масштаба (КРИТИЧНО! Структурные узлы должны строиться на основе этих данных)】
- Плановое количество глав: {{number_of_chapters}}
- Слов в главе: {{word_number}}
- Примерная общая длина: {{number_of_chapters}} × {{word_number}} слов

【Модель структуры истории — организуйте конспект строго по этой структуре】
{{plot_structure_guide}}

【Задание по генерации】
Строгий вывод сюжетного конспекта на весь роман. Пишите «структурные поворотные точки», а не подробный посценарный план. Корректируйте стратегию темпа на основе ключевой привлекательности жанра «{{genre}}».

【Требования】
1. Диапазоны глав для структурных узлов должны быть обозначены конкретными диапазонами на основе фактического масштаба [{{number_of_chapters}} глав]. Не используйте цифры, противорящие реальному количеству глав.
2. Каждый структурный узел должен указывать, «что именно произойдёт» — никаких абстрактных общих фраз.
3. Стратегия темпа должна соответствовать жанру «{{genre}}» (например, фэнтези силы делает акцент на унижении врагов и ритме прокачки; детектив — на уликах и поворотах; романтика — на эмоциях и недопонимании).
4. Точка зрения повествования — «{{narrative_pov}}» — при проектировании конспекта учитывайте, как ограничения точки зрения влияют на раскрытие информации и создание интриги.
5. Никогда не нарушайте запреты из глобальных требований к написанию.
6. Возвращайте только текст сюжетного конспекта — никакой воды или авторских ремарок.`
    },
    systemRoleLocalized: {
      en: 'You are a top-tier web novel planning expert and story architect.',
      ru: 'Вы — ведущий эксперт по планированию веб-романов и архитектор сюжетов.'
    },
  },



  // ================================================================
  // 章节蓝图生成
  // ================================================================

  {
    key: 'chapter_blueprint',
    name: '章节蓝图生成（全量）',
    description: '基于全书架构一次性生成所有章节的详细蓝图',
    systemRole: '你是一位经验丰富的网文架构师，擅长设计精密的章节蓝图。',
    variables: {
      novel_architecture: '完整故事架构（故事前提+角色图谱+世界观+情节大纲）',
      number_of_chapters: '总章数',
      global_guidance: '全局写作要求',
      genre: '小说类型',
      pacing_guidance: '节奏/风格指导（可选）',
    },
    content: `请基于我们此前推演出的【全书架构引擎】，为本书生成从第1章到第{{number_of_chapters}}章的具体"保姆级执行目录细纲"。

【核心防偏离守则】
- 小说题材：{{genre}}
- 全局写作要求与禁忌：{{global_guidance}}（这是绝对不能触碰的底线！）

【全书架构数据池】
{{novel_architecture}}

【商业网文节奏设计原则】
1. 黄金三章法则：第1章极速抛出"生存/高压困境"，第2章激活金手指/最大反差变量，第3章完成首次"小型打脸/破局"，留钩子。
2. 小高潮循环：严格执行"3-5章一个小循环"。
3. 拒绝水文与流水账：每一章都必须发生"实质性的事件变动"。
4. 悬念钩子机制：每章结尾必须有一个让读者想连续翻页的变数。

【输出格式规定】
严格且仅按以下 JSON 数组格式输出每一章：

{
  "blueprints": [
    {
      "chapterNumber": 1,
      "title": "引人入胜的标题",
      "purpose": "本章主角最想解决的一件事",
      "characters": ["本章互动的要人A", "要人B"],
      "keyEvents": "主角做了什么，遭遇了什么反转，金手指怎么用的。100字左右具体说明",
      "suspenseHook": "一句话说明结尾留了什么悬念"
    },
    {
      "chapterNumber": 2
    }
  ]
}

要求：
- 每章的 keyEvents 控制在 100-150 字以内，信息密度必须极高。
- 仅给出最终的 JSON 文本，不要任何客套解释。

★【作者节奏/风格指导（如有，最高优先级）】★：
{{pacing_guidance}}`,
    contentLocalized: {
      en: `Based on our previously derived [Full Novel Architecture Engine], generate a detailed "comprehensive execution blueprint" for chapters 1 through {{number_of_chapters}}.

【Core Anti-Divergence Rules】
- Novel genre: {{genre}}
- Global writing requirements: {{global_guidance}} (this is the absolute bottom line!)

【Full Novel Architecture Data Pool】
{{novel_architecture}}

【Commercial Web Novel Pacing Design Principles】
1. Golden Three Chapters Rule: Chapter 1 immediately presents a "survival / high-pressure dilemma"; Chapter 2 activates the golden finger / maximum contrast variable; Chapter 3 delivers the first "small face-slapping / breakthrough" with a hook.
2. Minor Climax Cycle: Strictly enforce a "small cycle every 3–5 chapters."
3. No filler or diary entries: Every chapter must feature a "substantive plot development."
4. Suspense Hook Mechanism: Every chapter ending must have a variable that makes readers want to turn the page.

【Output Format】
Output each chapter strictly and exclusively in the following JSON array format:

{
  "blueprints": [
    {
      "chapterNumber": 1,
      "title": "An engaging title",
      "purpose": "The one thing the protagonist most wants to resolve this chapter",
      "characters": ["Key person A interacting this chapter", "Person B"],
      "keyEvents": "What the protagonist did, what reversal they encountered, how the golden finger was used. Explain in about 100 words",
      "suspenseHook": "One sentence describing the cliffhanger left at the end"
    },
    {
      "chapterNumber": 2
    }
  ]
}

Requirements:
- Keep each chapter's keyEvents within 100–150 words with maximum information density.
- Output only the final JSON text — no pleasantries or explanations.

★【Author Pacing/Style Guidance (if any, HIGHEST PRIORITY)】★:
{{pacing_guidance}}`,
      ru: `На основе ранее выведенного [Полного архитектурного движка романа] создайте подробный «комплексный план выполнения» для глав 1–{{number_of_chapters}}.

【Правила предотклонения от основы】
- Жанр романа: {{genre}}
- Глобальные требования к написанию: {{global_guidance}} (это абсолютный запрет!)

【Пул данных архитектуры романа】
{{novel_architecture}}

【Принципы проектирования темпа коммерческого веб-романа】
1. Правило первых трёх глав: Глава 1 немедленно представляет «ситуацию выживания / высокого давления»; Глава 2 активирует золотой палец / максимальную переменную контраста; Глава 3 выдаёт первое «маленькое унижение врага / прорыв» с крючком.
2. Цикл малых кульминаций: строго соблюдайте «малый цикл каждые 3–5 глав».
3. Никакой воды и дневниковых записей: каждая глава должна содержать «существенное развитие сюжета».
4. Механизм интриги: каждое завершение главы должно содержать переменную, заставляющую читателя перевернуть страницу.

【Формат вывода】
Выведите каждую главу строго и исключительно в следующем формате JSON-массива:

{
  "blueprints": [
    {
      "chapterNumber": 1,
      "title": "Интересный заголовок",
      "purpose": "То, что герой хочет решить больше всего в этой главе",
      "characters": ["Ключевой персонаж A", "Персонаж B"],
      "keyEvents": "Что сделал герой, какой контратаки он столкнулся, как был использован золотой палец. Опишите примерно 100 слов",
      "suspenseHook": "Одно предложение, описывающее интригу конца главы"
    }
  ]
}

Требования:
- Удерживайте keyEvents каждой главы в пределах 100–150 слов с максимальной плотностью информации.
- Выводите только финальный JSON — никаких вступлений или объяснений.

【Руководство автора по темпу/стилю (если есть, ВЫСШИЙ ПРИОРИТЕТ)】★:
{{pacing_guidance}}`
    },
    systemRoleLocalized: {
      en: 'You are an experienced web novel architect skilled at designing precise chapter blueprints.',
      ru: 'Вы — опытный архитектор веб-романов, искусно проектирующий точные планы глав.'
    },
  },

  {
    key: 'chapter_blueprint_chunk',
    name: '章节蓝图续写（分块）',
    description: '在已有目录基础上续写后续章节蓝图，支持分块生成',
    systemRole: '你是一位经验丰富的网文架构师，擅长设计精密的章节蓝图。',
    variables: {
      novel_architecture: '完整故事架构（故事前提+角色图谱+世界观+情节大纲）',
      chapter_list: '已生成的章节列表（最近100章）',
      number_of_chapters: '总章数',
      n: '起始章节号',
      m: '结束章节号',
      global_guidance: '全局写作要求',
      genre: '小说类型',
      pacing_guidance: '节奏/风格指导（可选）',
    },
    content: `请基于【全书架构引擎】与【已生成的目录进度】，为接下来的 第{{n}}章到第{{m}}章 生成极其严密的"保姆级执行目录细纲"。

【核心防偏离守则】
- 小说题材：{{genre}}
- 全书规模：共 {{number_of_chapters}} 章
- 全局写作要求与禁忌：{{global_guidance}}（这是绝对不能触碰的底线！）

【全书架构数据池】
{{novel_architecture}}

【前置剧情进度与连贯性检查】
以下是前置章节（简略截取，以防遗忘主线进度）：
{{chapter_list}}

【本次生成任务：接力推演】
请紧密承接上面最后一章的情节，继续严密推演 第{{n}}章 到 第{{m}}章。
1. 连续小高潮法则：维持每 3-5 章一个小高潮的节奏。
2. 伏笔强制回收与释放：如果前面章节留下了危机，这里必须引爆或解决。
3. 拒绝水文：每一章都必须有实质性进展。

【输出格式规定】
严格且仅按以下 JSON 数组格式输出每一章：

{
  "blueprints": [
    {
      "chapterNumber": n,
      "title": "引人入胜的标题",
      "purpose": "本章主角最想解决的一件事",
      "characters": ["本章互动的要人A", "要人B"],
      "keyEvents": "具体发生了什么，金手指怎么运作的。100字左右",
      "suspenseHook": "结尾留的钩子"
    }
  ]
}

要求：
- 严格遵循上下文连贯，不要前后矛盾。
- 仅给出最终的 JSON 文本，不要解释。

★【作者节奏/风格指导（如有，最高优先级）】★：
{{pacing_guidance}}`,
    contentLocalized: {
      en: `Based on the [Full Novel Architecture Engine] and the [Existing Blueprint Progress], generate an extremely detailed "comprehensive execution blueprint" for the next chapters: Chapter {{n}} through Chapter {{m}}.

【Core Anti-Divergence Rules】
- Novel genre: {{genre}}
- Total novel scale: {{number_of_chapters}} chapters
- Global writing requirements: {{global_guidance}} (this is the absolute bottom line!)

【Full Novel Architecture Data Pool】
{{novel_architecture}}

【Previous Plot Progress & Continuity Check】
Below is the preceding chapter summary (abridged to prevent losing sight of the main plot):
{{chapter_list}}

【This Generation Task: Relay Derivation】
Pick up seamlessly from the last chapter's plot and rigorously derive Chapter {{n}} through Chapter {{m}}.
1. Continuous Minor Climax Rule: Maintain the rhythm of one minor climax every 3–5 chapters.
2. Foreshadowing Enforcement: If previous chapters left a crisis hanging, it must detonate or resolve here.
3. No filler: Every chapter must have substantive progress.

【Output Format】
Output each chapter strictly and exclusively in the following JSON array format:

{
  "blueprints": [
    {
      "chapterNumber": n,
      "title": "An engaging title",
      "purpose": "The one thing the protagonist most wants to resolve this chapter",
      "characters": ["Key person A interacting this chapter", "Person B"],
      "keyEvents": "What specifically happened, how the golden finger operated. About 100 words",
      "suspenseHook": "The hook left at the end"
    }
  ]
}

Requirements:
- Strictly maintain contextual continuity — no contradictions.
- Output only the final JSON text — no explanations.

★【Author Pacing/Style Guidance (if any, HIGHEST PRIORITY)】★:
{{pacing_guidance}}`,
      ru: `На основе [Полного архитектурного движка романа] и [Текущего прогресса плана] создайте максимально подробный «комплексный план выполнения» для следующих глав: Глава {{n}}–{{m}}.

【Правила предотклонения от основы】
- Жанр романа: {{genre}}
- Общий масштаб романа: {{number_of_chapters}} глав
- Глобальные требования к написанию: {{global_guidance}} (это абсолютный запрет!)

【Пул данных архитектуры романа】
{{novel_architecture}}

【Предыдущий прогресс сюжета и проверка непрерывности】
Ниже приведён краткий обзор предыдущих глав (сжатый, чтобы не потерять основную сюжетную линию):
{{chapter_list}}

【Задание по генерации: ретрансляция】
Плавно перенмите от сюжета последней главы и строго выведите Главы {{n}}–{{m}}.
1. Правило непрерывных малых кульминаций: поддерживайте ритм одной малой кульминации каждые 3–5 глав.
2. Обязательное раскрытие зацепок: если в предыдущих главах остался кризис — он должен здесь взорваться или разрешиться.
3. Никакой воды: каждая глава должна содержать существенное развитие.

【Формат вывода】
Выведите каждую главу строго и исключительно в следующем формате JSON-массива:

{
  "blueprints": [
    {
      "chapterNumber": n,
      "title": "Интересный заголовок",
      "purpose": "То, что герой хочет решить больше всего в этой главе",
      "characters": ["Ключевой персонаж A", "Персонаж B"],
      "keyEvents": "Что конкретно произошло, как работал золотой палец. Примерно 100 слов",
      "suspenseHook": "Крючок, оставленный в конце"
    }
  ]
}

Требования:
- Строго соблюдайте контекстуальную непрерывность — никаких противоречий.
- Выводите только финальный JSON — никаких объяснений.

★【Руководство автора по темпу/стилю (если есть, ВЫСШИЙ ПРИОРИТЕТ)】★:
{{pacing_guidance}}`
    },
    systemRoleLocalized: {
      en: 'You are an experienced web novel architect skilled at designing precise chapter blueprints.',
      ru: 'Вы — опытный архитектор веб-романов, искусно проектирующий точные планы глав.'
    },
  },

  // ================================================================
  // 写稿
  // ================================================================

  {
    key: 'first_chapter_draft',
    name: '第一章草稿',
    description: '生成小说第一章的完整正文',
    systemRole: '你是一位笔力精湛的顶尖网文小说家，擅长撰写引人入胜、让读者欲罢不能的商业网文正文。',
    variables: {
      architecture: '故事架构（故事前提+角色图谱+世界观+情节大纲）',
      chapter_info: '本章信息（JSON）',
      future_blueprints: '后续章节蓝图（防止剧情提前）',
      global_guidance: '全局写作要求',
      word_number: '目标字数',
      writing_style: '文风描述（可选）',
      user_guidance: '作者本章微操指导（可选）',
    },
    content: `请开始创作这本小说的第一章（破冰章）。

【全书设定池】
{{architecture}}

【本章信息】
{{chapter_info}}

【后续章节大纲预告】（仅供了解后续剧情发力点，请绝对不要在本章提前写出后续内容！）
{{future_blueprints}}

【全局写作要求】
{{global_guidance}}

【网文"黄金第一章"创作法则】
1. 开场即高能（黄金三秒）：绝不要用长篇大论介绍世界观。起笔第一句必须直接切入一个动作、一次高压审问、一场追杀或一个极具落差感的嘲讽现场。
2. 巧妙引出金手指：在主角陷入困境的最深处，让金手指以一种让人期待的方式展现。
3. 多动少静（动作与对话驱动）：绝不使用上帝视角的干瘪陈述句，全部改成"角色对话 + 神态描写 + 动作互动"。
4. 规避毒点：严格避让全局写作要求与禁忌。

【文风要求（如有，请严格遵循）】
{{writing_style}}`,
    systemSuffix: `★【作者对本步骤的额外指导（如有，最高优先级）】★：
{{user_guidance}}

【具体生成要求】
- 体量与节奏控制：大约 {{word_number}} 字左右。本章仅推演【本章信息】中规定的核心剧情，切忌注水！不要为了凑字数而撰写冗余的旁白科普或无意义的日常对话。达成首章目标后立刻留悬念断章，绝不可提前泄露后续情节。
- 格式要求：直接输出纯文本正文。禁止使用任何 Markdown 语法符号（如不要用 * 或 ** 或 # 等）。所有对话必须使用标准中文双引号，严禁使用剧本式的对话格式。
- **强制排版要求：【段落与段落之间必须保留一个空行作为分隔】。绝对不允许连续多行不留空行！**
- 结尾法则：在章节的最后一行留置一个强力钩子。

【AI 味反制——以下模式严禁出现】
- 禁止段尾总结句（如“他知道，这一切才刚刚开始”、“命运的齿轮开始转动”）
- “仿佛”、“犹如”、“宛如”全章合计不超过3次
- 对话必须区分角色语气：不同角色的说话方式必须有辨识度
- 禁止在结尾添加与正文无关的哲理感悟或旁白总结`,
    contentLocalized: {
      en: `Begin writing the first chapter (the hook chapter) of this novel.

【Full Novel Setting Pool】
{{architecture}}

【This Chapter's Info】
{{chapter_info}}

【Future Chapter Outline Preview】(for awareness only — DO NOT write any future content in this chapter!)
{{future_blueprints}}

【Global Writing Requirements】
{{global_guidance}}

【Web Novel "Golden First Chapter" Creation Rules】
1. Open with high energy (golden 3 seconds): Never use lengthy worldbuilding exposition. The opening sentence must dive straight into an action, a high-pressure interrogation, a chase, or a moment of sharp ironic contrast.
2. Cleverly introduce the golden finger: At the protagonist's deepest point of desperation, reveal the golden finger in a way that builds anticipation.
3. Motion over stillness (action and dialogue driven): Never use dry omniscient narration — replace everything with "character dialogue + body language + action interaction."
4. Avoid prohibited elements: Strictly adhere to global writing requirements.

【Writing Style Requirements (if any, follow strictly)】
{{writing_style}}`,
      ru: `Начните писать первую главу (зацепляющую главу) этого романа.

【Пул настроек романа】
{{architecture}}

【Информация об этой главе】
{{chapter_info}}

【Предварительный просмотр конспектов будущих глав】(только для ознакомления — НЕ пишите ничего из будущего в этой главе!)
{{future_blueprints}}

【Глобальные требования к написанию】
{{global_guidance}}

【Правила создания «Золотой первой главы» веб-романа】
1. Откройте с высокой энергией (золотые 3 секунды): никогда не используйте пространные описания мира. Первое предложение должно сразу погрузить в действие, допрос под давлением, погоню или момент острого иронического контраста.
2. Изящно представьте золотой палец: в самой глубокой точке отчаяния героя покажите золотой палец так, чтобы это создало ожидание.
3. Движение вместо статики (через действия и диалоги): никогда не используйте сухое всеведущее повествование — замените всё на «диалоги персонажей + язык тела + действия».
4. Избегайте запрещённых элементов: строго следуйте глобальным требованиям.

【Требования к стилю (если есть, строго соблюдайте)】
{{writing_style}}`
    },
    systemRoleLocalized: {
      en: 'You are a masterful web novel author, skilled at writing gripping, page-turning commercial fiction.',
      ru: 'Вы — мастерски владеющий пером автор веб-романов, искусно пишущий захватывающую, увлекательную коммерческую прозу.'
    },
  },

  {
    key: 'next_chapter_draft',
    name: '后续章节草稿',
    description: '基于上下文和章节蓝图生成后续章节',
    systemRole: '你是一位笔力精湛的顶尖网文小说家，擅长撰写引人入胜、让读者欲罢不能的商业网文正文。',
    variables: {
      canon_context: '【强制】叙事一致性 Canon Context（最高优先级：包含正史设定、人物状态、时间线、最近章节摘要、未结剧情、本章目标、RAG、风格、硬性约束）',
      global_summary: '章节要点时间线（从蓝图按序拼装）',
      character_states: '角色状态',
      short_summary: '近期三章简要',
      previous_ending: '上章结尾800字',
      chapter_info: '本章蓝图信息（JSON）',
      future_blueprints: '后续章节蓝图（防止剧情提前）',
      user_guidance: '作者本章微操指导（可选）',
      filtered_context: '知识库检索结果',
      global_guidance: '全局写作要求',
      word_number: '目标字数',
      writing_style: '文风描述（可选）',
    },
    content: `你正在连载写作最新章节。

【★★★ 叙事一致性 Canon 上下文（必须严格遵循 · 优先级最高）★★★】
{{canon_context}}

【剧情记忆库与前置断点上下文】
- [全局剧情进展]：{{global_summary}}
- [角色状态监控]：{{character_states}}
- [近期三章简要]：{{short_summary}}
★【上一章结尾最后一小段（极其关键，起笔必须无缝衔接）】★：
{{previous_ending}}

【本章写作方向与核心任务】
{{chapter_info}}

【后续章节大纲预告】（仅供了解后续剧情发力点，请绝对不要在本章提前写出后续内容！）
{{future_blueprints}}

【知识库资料（如有）】
{{filtered_context}}

【网文连载更新核心法则】
1. 无缝衔接断句：你的第一段必须自然、丝滑地接续上一章结尾，绝不允许出现场景瞬移或突兀的视角跳跃。
2. 动作与神态驱动：用动态的描写推动剧情，不要写"他们聊了很久"，用拔剑声、茶水滴落声、瞳孔的骤缩来代替。
3. 落实本章核心冲突：用{{word_number}}字左右的篇幅，踏踏实实地推演完本章目标，拒绝平淡流水账。
4. 悬念断章大法：全章的最后一段，必须卡在一个剧情的小高潮点或突发变故上。
5. 底线铁律：严禁碰触【全局写作要求与禁忌】：{{global_guidance}}。

【文风要求（如有，请严格遵循）】
{{writing_style}}`,
    systemSuffix: `★【作者对本步骤的额外指导（如有，最高优先级）】★：
{{user_guidance}}

【输出格式】
- 体量与节奏控制：大约 {{word_number}} 字左右。本章仅推演【本章信息】中规定的核心冲突，切忌注水！达成目标即立刻断章，绝不可擅自拓展后续大纲的情节。
- 仅输出纯文本正文！绝对不要在开头写"第x章 正文如下"。
- 强制要求纯文本，禁止使用任何 Markdown 语法符号。所有对话必使用双引号，严禁剧本式格式。
- **强制排版要求：【段落与段落之间必须毫无例外地保留一个空行作为分隔】。禁止将多个段落紧凑拼凑成一大块！**

【AI 味反制——以下模式严禁出现】
- 禁止段尾总结句（如"他知道，这一切才刚刚开始"、"命运的齿轮开始转动"）
- "仿佛"、"犹如"、"宛如"全章合计不超过3次
- 对话必须区分角色语气：不同角色的说话方式必须有辨识度
- 禁止在结尾添加与正文无关的哲理感悟或旁白总结`,
    contentLocalized: {
      en: `You are continuing serialization with the latest chapter.

【★★★ Narrative Consistency Canon Context (MUST follow strictly · HIGHEST PRIORITY) ★★★】
{{canon_context}}

【Plot Memory Bank & Prior Breakpoint Context】
- [Global plot progress]: {{global_summary}}
- [Character state monitoring]: {{character_states}}
- [Recent three chapters brief]: {{short_summary}}
★【Last paragraph of the previous chapter (CRITICAL — opening must connect seamlessly)】★:
{{previous_ending}}

【This Chapter's Writing Direction & Core Task】
{{chapter_info}}

【Future Chapter Outline Preview】(for awareness only — DO NOT write any future content in this chapter!)
{{future_blueprints}}

【Knowledge Base Materials (if any)】
{{filtered_context}}

【Core Serialization Update Rules】
1. Seamless sentence bridging: Your first paragraph must naturally and smoothly continue from the previous chapter's ending — absolutely no scene jumps or abrupt POV shifts.
2. Action and body language driven: Use dynamic descriptions to push the plot. Don't write "they talked for a long time" — use the sound of a sword drawn, tea dripping, pupils contracting.
3. Execute this chapter's core conflict: In approximately {{word_number}} words, thoroughly play out this chapter's objective — no bland diary entries.
4. Suspense cliffhanger technique: The final paragraph must land on a minor climax or sudden twist.
5. Iron-bottom rule: Never violate [Global Writing Requirements]: {{global_guidance}}.

【Writing Style Requirements (if any, follow strictly)】
{{writing_style}}`,
      ru: `Вы продолжаете сериал сlatest главой.

【★★★ Контекст канона нарративной согласованности (СТРОГО соблюдать · ВЫСШИЙ ПРИОРИТЕТ) ★★★】
{{canon_context}}

【Банк памяти сюжета и контекст предыдущей точки разрыва】
- [Глобальный прогресс сюжета]: {{global_summary}}
- [Мониторинг состояния персонажей]: {{character_states}}
- [Краткое содержание последних трёх глав]: {{short_summary}}
★【Последний абзац предыдущей главы (КРИТИЧНО — начало должно бесшовно продолжать)】★:
{{previous_ending}}

【Направление написания этой главы и основная задача】
{{chapter_info}}

【Предварительный просмотр конспектов будущих глав】(только для ознакомления — НЕ пишите ничего из будущего в этой главе!)
{{future_blueprints}}

【Материалы из базы знаний (если есть)】
{{filtered_context}}

【Основные правила обновления сериала】
1. Бесшовное соединение предложений: ваш первый абзац должен естественно и плавно продолжать концовку предыдущей главы — абсолютно никаких скачков сцены или резких переключений точки зрения.
2. Через действия и язык тела: используйте динамичные описания для продвижения сюжета. Не пишите «они долго разговаривали» — используйте звук вынутого меча, капающий чай, резкое сужение зрачков.
3. Выполните основной конфликт этой главы: в объёме примерно {{word_number}} слов тщательно разыграйте цель этой главы — никаких скучных дневниковых записей.
4. Техника интриги: последний абзац должен завершиться малой кульминацией или внезапным поворотом.
5. Железное правило: никогда не нарушайте [Глобальные требования к написанию]: {{global_guidance}}.

【Требования к стилю (если есть, строго соблюдайте)】
{{writing_style}}`
    },
    systemRoleLocalized: {
      en: 'You are a masterful web novel author, skilled at writing gripping, page-turning commercial fiction.',
      ru: 'Вы — мастерски владеющий пером автор веб-романов, искусно пишущий захватывающую, увлекательную коммерческую прозу.'
    },
  },

  // ================================================================
  // 修稿
  // ================================================================

  {
    key: 'refine_chapter',
    name: '大神级修稿',
    description: '将草稿提升到大神级质量',
    systemRole: '你是一位功力深厚的文学编辑，擅长将普通文稿精修为白金品质力作。',
    variables: {
      canon_context: '【强制】叙事一致性 Canon Context（精修时绝不可破坏的事实基线）',
      draft_content: '章节草稿内容',
      chapter_info: '章节信息',
      global_guidance: '写作要求',
      global_summary: '近章要点（蓝图摘要）',
      short_summary: '近章摘要',
      word_number: '目标字数',
      user_refine_prompt: '用户自定义修稿指导（可选）',
      writing_style: '文风描述（可选）',
    },
    content: `请对章节草稿进行【精修与细节填充】。

【★★★ 叙事一致性 Canon 上下文（精修时绝不可破坏的事实基线）★★★】
{{canon_context}}

【剧情上下文】
- 全书目前进度摘要：{{global_summary}}
- 近期章节回顾：{{short_summary}}

【本章信息】
{{chapter_info}}

【精修要求】
1. 画面感（Sense of Presence）：通过"五感"细节（视觉、听觉、嗅觉、触觉）强化环境描写，拒绝干瘪的白开水叙事。
2. 设定咬合：巧妙地将金手指的使用细节融入战斗或博弈中，体现主角的差异化优势。
3. 情绪张力：强化反派的压迫感与主角的回击力度。遵循"欲扬先抑"法则，但在高潮处必须给足爽感。
4. 词汇升级：使用更精准、更具镜头感的动作词汇。用动作和细节来展示情绪（Show, Don't Tell）。
5. 钩子与节奏：检查结尾处是否有强力钩子（Hook），确保读者有强烈的追读欲望。
6. 防注水平替制：精修的本质是词汇平替、提升画面感，绝非拉长篇幅和增注冗长旁白。目标字数控制在 {{word_number}} 字左右。如果发现原文有啰嗦的动作描写或说教式科普，请果断删减，严禁无限扩写把节奏拖慢。

【全局写作禁忌】
{{global_guidance}}

【待精修原稿】
{{draft_content}}

【文风要求（如有，精修时严格向此风格靠拢）】
{{writing_style}}`,
    systemSuffix: `★【作者对本步骤的额外指导（如有，最高优先级）】★：
{{user_refine_prompt}}

请直接输出精修后的全文章节内容。强制要求纯文本，禁止使用任何 Markdown 语法符号，严禁剧本式对话。【严禁】任何开场白或解释文字。
**【强制排版底线】：段落与段落之间必须保留一个空行作为分隔，绝不允许不留空行的连续长段落。**`,
    contentLocalized: {
      en: `Please perform a [polish and detail enrichment] pass on this chapter draft.

【★★★ Narrative Consistency Canon Context (MUST NOT violate during polish) ★★★】
{{canon_context}}

【Plot Context】
- Current global progress summary: {{global_summary}}
- Recent chapters review: {{short_summary}}

【This Chapter's Info】
{{chapter_info}}

【Polish Requirements】
1. Sensory Presence: Strengthen environmental descriptions through "five senses" details (sight, sound, smell, touch, taste) — reject bland, watered-down narration.
2. Setting Integration: Skillfully weave golden finger usage details into combat or strategy scenes, showcasing the protagonist's differentiated advantage.
3. Emotional Tension: Amplify the antagonist's oppressive presence and the protagonist's counterforce. Follow the "build-up before the payoff" rule, but deliver maximum satisfaction at the climax.
4. Vocabulary Upgrade: Use more precise, cinematic action verbs. Show emotions through actions and details (Show, Don't Tell).
5. Hook and Pacing: Check whether the ending has a strong hook (Hook) that gives readers a compelling urge to continue reading.
6. Anti-Filler Substitution: Polish means vocabulary substitution and enhanced sensory presence — NOT padding the word count with bloated exposition or sermon-like exposition. Target approximately {{word_number}} words. If you find verbose action descriptions or preachy exposition, cut decisively — never infinitely expand and drag down the pacing.

【Global Writing Prohibitions】
{{global_guidance}}

【Original Draft to Polish】
{{draft_content}}

【Writing Style Requirements (if any, polish strictly toward this style)】
{{writing_style}}`,
      ru: `Пожалуйста, выполните этап [шлифовки и обогащения деталями] для этого черновика главы.

【★★★ Контекст канона нарративной согласованности (НЕ НАРУШАТЬ при шлифовке) ★★★】
{{canon_context}}

【Контекст сюжета】
- Краткое содержание текущего глобального прогресса: {{global_summary}}
- Обзор последних глав: {{short_summary}}

【Информация об этой главе】
{{chapter_info}}

【Требования к шлифовке】
1. Ощущение присутствия: усильте описания окружения через детали «пяти чувств» (зрение, слух, обоняние, осязание, вкус) — отбрасывайте водянистое повествование.
2. Интеграция сеттинга: искусно вплетайте детали использования золотого пальца в боевые или стратегические сцены, демонстрируя дифференцированное преимущество героя.
3. Эмоциональное напряжение: усиливайте давящее присутствие антагониста и контрудар героя. Следуйте правилу «нарастание перед кульминацией», но обеспечивайте максимальное удовлетворение в кульминационный момент.
4. Обновление словаря: используйте более точные, кинематографичные глаголы действия. Покажите эмоции через действия и детали (Покажи, а не расскажи).
5. Крючок и темп: проверьте, есть ли в конце сильный крючок (Hook), дающий читателю непреодолимое желание продолжить чтение.
6. Антиводозамена: шлифовка — это замена слов и усиление ощущения присутствия — А НЕ наращивание объёма пространными описаниями или поучительными отступлениями. Целевой объём: примерно {{word_number}} слов. Если встречается многословное описание действий или поучительная проповедь —果断 сокращайте, никогда не раздувайте бесконечно и не замедляйте темп.

【Глобальные запреты на написание】
{{global_guidance}}

【Исходный черновик для шлифовки】
{{draft_content}}

【Требования к стилю (если есть, при шлифовке строго приближайтесь к этому стилю)】
{{writing_style}}`
    },
    systemRoleLocalized: {
      en: 'You are a seasoned literary editor, skilled at elevating ordinary drafts to platinum-quality masterpieces.',
      ru: 'Вы — опытный литературный редактор, искусно превращающий обычные черновики в произведения платинового качества.'
    },

  },

  // ================================================================
  // 审稿
  // ================================================================

  {
    key: 'consistency_check',
    name: '一致性审稿',
    description: '检查章节的一致性问题',
    systemRole: '你是一位极其严谨、铁面无私的小说质量监督编辑。你只检查客观事实问题，绝不评价主观文笔。',
    variables: {
      chapter_content: '章节内容',
      character_states: '角色状态',
      global_summary: '上下文检索结果',
      world_building: '世界观设定',
      canon_context: '已确立事实（时间线+角色状态+剧情线+硬性约束），用于交叉验证',
      review_focus: '审稿维度侧重点（可选）',
    },
    content: `请对以下章节进行审查。

【待审章节】
{{chapter_content}}

【角色状态】
{{character_states}}

【全局摘要】
{{global_summary}}


【已确立事实基线（用于交叉验证 — 所有事实以此为准，本章不得与之矛盾）】
{{canon_context}}

【世界观设定】
{{world_building}}

【审查原则】

1. 举证审查：只报告有明确文本证据的问题。每个问题必须引用原文具体句子。
2. 宁缺毋滥：没有问题的维度，输出一条 severity 为 pass 的记录即可。不要凑数量。
3. 只查一致性不评文笔：不报告风格偏好、文笔建议、创作建议。只报告可验证的事实矛盾。
4. 客观可验证：报出的每个问题必须能被第三方编辑复查确认。

【检查维度】

1. 剧情连贯性：本章情节是否与前文（全局摘要）有矛盾？前后文是否自相矛盾？
2. 剧情合理性：因果逻辑是否成立？人物动机是否合理？是否有常识性硬伤？
3. 角色状态：角色行为、能力、位置、情感是否与角色状态档案一致？
4. 前后章节串联：伏笔、悬念是否连贯？是否出现未交代前因的突兀情节？
5. 伏笔完整性：本章是否存在应回收而未提及的前置伏笔？是否有与已知伏笔体系冲突的新增设置？

`,
    systemSuffix: `★【作者要求重点检查的维度（如有，这些维度必须优先、深入检查）】★：
{{review_focus}}

## 输出格式（JSON）

请严格输出以下 JSON 格式：

{"items":[{"category":"剧情连贯性","severity":"pass","description":"未发现与前文矛盾"},{"category":"剧情合理性","severity":"error","quote":"原文中的具体句子","description":"问题描述"},{"category":"角色状态","severity":"warning","quote":"原文句子","description":"轻微不一致说明"}],"summary":"一句话总体评价"}

severity 取值：error=严重矛盾强烈建议修复, warning=轻微不一致酌情修复, pass=该维度通过无问题。
每个 category 至少输出一条记录。quote 字段在 pass 时可省略。`,
    contentLocalized: {
      en: `Please review the following chapter.

【Chapter Under Review】
{{chapter_content}}

【Character States】
{{character_states}}

【Global Summary】
{{global_summary}}


【Established Facts Baseline (for cross-validation — all facts take precedence here; this chapter must not contradict them)】
{{canon_context}}

【Worldbuilding】
{{world_building}}

【Review Principles】

1. Evidence-based review: Only report problems with clear textual evidence. Each problem must cite a specific sentence from the original text.
2. Quality over quantity: For dimensions with no issues, output a single record with severity "pass." Don't pad the count.
3. Check consistency only — no style critique: Do not report style preferences, writing suggestions, or creative advice. Only report verifiable factual contradictions.
4. Objective and verifiable: Each problem you report must be confirmable by a third-party editor.

【Check Dimensions】

1. Plot Continuity: Does this chapter's plot contradict earlier content (global summary)? Are there self-contradictions within the chapter?
2. Plot Logic: Do cause-and-effect relationships hold up? Are character motivations plausible? Are there common-sense errors?
3. Character States: Are character behaviors, abilities, locations, and emotions consistent with the character state files?
4. Cross-Chapter Continuity: Are foreshadowing and suspense lines consistent? Are there abrupt plot developments without established cause?
5. Foreshadowing Completeness: Are there any foreshadowed elements from prior chapters that should have been resolved but weren't? Are there new settings that conflict with the established foreshadowing system?`,
      ru: `Пожалуйста, проверьте следующую главу.

【Проверяемая глава】
{{chapter_content}}

【Состояния персонажей】
{{character_states}}

【Глобальное резюме】
{{global_summary}}


【Базовый набор установленных фактов (для перекрёстной проверки — все факты здесь имеют приоритет; эта глава не должна им противоречить)】
{{canon_context}}

【Мироздание】
{{world_building}}

【Принципы проверки】

1. Проверка на основе доказательств: сообщайте только о проблемах с чёткой текстовой поддержкой. Каждая проблема должна цитировать конкретное предложение из оригинального текста.
2. Качество важнее количества: для измерений без проблем выводите одну запись со severity «pass». Не наращивайте количество.
3. Проверяйте только согласованность — без критики стиля: не сообщайте о предпочтениях стиля, советах по написанию или творческих рекомендациях. Только проверяемые фактологические противоречия.
4. Объективность и проверяемость: каждая проблема, о которой вы сообщаете, должна быть подтверждаема сторонним редактором.

【Измерения для проверки】

1. Непрерывность сюжета: противоречит ли сюжет этой главы предыдущему контенту (глобальное резюме)? Есть ли внутренние противоречия?
2. Логика сюжета: выдерживают ли причинно-следственные связи? Правдоподобны ли мотивации персонажей? Есть ли ошибки здравого смысла?
3. Состояния персонажей: соответствуют ли поведение, способности, местоположение и эмоции персонажей файлам состояний?
4. Сквозная непрерывность: последовательны ли линии предвестий и интриг? Есть ли резкие сюжетные повороты без установленной причины?
5. Полнота предвестий: остались ли какие-либо элементы из предыдущих глав, которые должны были быть раскрыты, но не были? Есть ли новые настройки, противоречащие установленной системе предвестий?`
    },
    systemRoleLocalized: {
      en: 'You are a meticulous, impartial quality control editor. You check only objective factual issues — you never evaluate subjective writing quality.',
      ru: 'Вы — тщательный, беспристрастный редактор контроля качества. Вы проверяете только объективные фактологические проблемы — никогда не оцениваете субъективное качество текста.'
    },
  },

  // ================================================================
  // 文风分析
  // ================================================================

  {
    key: 'analyze_writing_style',
    name: '文风分析',
    description: '从正文样本中提取作者的写作风格特征',
    systemRole: '你是一位资深的文学评论家和网文研究者，擅长精准捕捉作者的写作风格指纹。',
    variables: {
      sample_text: '正文采样文本（3-5章拼接）',
    },
    content: `请仔细阅读以下小说正文样本，深度分析并提炼作者的写作风格特征。

【正文样本】
{{sample_text}}

【分析维度与输出要求】
请从以下 7 个维度分析，每个维度用 2-3 句话精准概括，并附带 1 个原文例句作为佐证（总计 300-500 字）：

1. 叙述节奏：整体叙事快慢、场景切换频率、段落长短偏好
2. 描写密度：环境描写/动作描写/心理描写的比重偏好
3. 对话风格：对话在全文中的比例、对话的口语化程度、是否使用方言或特殊腔调
4. 用词偏好：是否偏好古风用词/现代流行语/专业术语、整体词汇丰富度
5. 情感基调：整体偏热血/冷峻/诙谐/沉重/轻松
6. 叙事视角习惯：主要用第几人称、是否频繁切换视角、内心独白的使用频率
7. 标志性手法：作者特有的修辞手法、常用的过渡技巧、独特的段落结构

【输出格式】
直接输出纯文本分析结果，使用以下格式：

叙述节奏：……
描写密度：……
对话风格：……
用词偏好：……
情感基调：……
叙事视角：……
标志性手法：……

不要添加任何无关解释或客套话。`,
    contentLocalized: {
      en: `Please carefully read the following novel text sample and deeply analyze the author's writing style characteristics.

【Text Sample】
{{sample_text}}

【Analysis Dimensions & Output Requirements】
Analyze across the following 7 dimensions, using 2–3 precise sentences per dimension with 1 original-text quote as evidence (total 300–500 words):

1. Narrative Pacing: overall narrative speed, scene transition frequency, paragraph length preferences
2. Descriptive Density: ratio of environment/action/psychological descriptions
3. Dialogue Style: proportion of dialogue in the text, level of colloquialism, use of dialect or distinctive speech patterns
4. Vocabulary Preference: classical/literary phrasing vs. modern slang vs. technical jargon, overall lexical richness
5. Emotional Tone: overall lean toward hot-blooded / cool and detached / witty / somber / lighthearted
6. Narrative POV Habits: primary person used, frequency of POV switches, frequency of internal monologue
7. Signature Techniques: the author's distinctive rhetorical devices, common transitional techniques, unique paragraph structures

【Output Format】
Output the analysis as plain text using the following format:

Narrative Pacing: …
Descriptive Density: …
Dialogue Style: …
Vocabulary Preference: …
Emotional Tone: …
Narrative POV: …
Signature Techniques: …

Do not add any irrelevant explanations or pleasantries.`,
      ru: `Пожалуйста, внимательно прочитайте следующий образец текста романа и глубоко проанализируйте стилистические особенности автора.

【Образец текста】
{{sample_text}}

【Измерения анализа и требования к выводу】
Проанализируйте по следующим 7 измерениям, используя 2–3 точных предложения на измерение с 1 цитатой из оригинала в качестве доказательства (всего 300–500 слов):

1. Ритм повествования: общая скорость повествования, частота переключения сцен, предпочтения по длине абзацев
2. Плотность описаний: соотношение описаний окружения / действий / переживаний
3. Стиль диалогов: доля диалогов в тексте, уровень разговорности, использование диалекта или характерной речи
4. Лексические предпочтения: литературная / архаичная речь vs. современный сленг vs. профессиональный жаргон, общая лексическая насыщенность
5. Эмоциональный тон: общий уклон в сторону героического / холодно-отстранённого / ироничного / мрачного / лёгкого
6. Привычки точки зрения: основное лицо повествования, частота переключений точки зрения, частота внутреннего монолога
7. Фирменные приёмы: характерные риторические устройства автора, типичные переходы, уникальная структура абзацев

【Формат вывода】
Выведите анализ в виде простого текста в следующем формате:

Ритм повествования: …
Плотность описаний: …
Стиль диалогов: …
Лексические предпочтения: …
Эмоциональный тон: …
Точка зрения: …
Фирменные приёмы: …

Не добавляйте лишних пояснений или вступлений.`
    },
    systemRoleLocalized: {
      en: 'You are a seasoned literary critic and web novel researcher, skilled at precisely capturing an author\'s writing style fingerprint.',
      ru: 'Вы — опытный литературный критик и исследователь веб-романов, искусно точно определяющий стилистический «отпечаток» автора.'
    },
  },

  {
    key: 'refine_from_review',
    name: '审稿驱动修稿',
    description: '根据审稿报告中的问题精准修复草稿',
    systemRole: '你是一位严谨的小说编辑，擅长精准修复文本中的具体问题而不过度改写。',
    variables: {
      canon_context: '【强制】叙事一致性 Canon Context（审稿修复时绝不可破坏的事实基线）',
      review_report: '审稿报告内容',
      draft_content: '待修稿内容',
      global_guidance: '全局写作要求',
      user_refine_prompt: '用户额外修稿指导（可选）',
    },
    content: `请根据【审稿报告】中列出的问题，对草稿进行**精准修复**。

【★★★ 叙事一致性 Canon 上下文（修复时绝不可破坏的事实基线）★★★】
{{canon_context}}

【审稿报告】
{{review_report}}

【待修稿内容】
{{draft_content}}

【全局写作要求】
{{global_guidance}}

【修复原则】
1. 只修复审稿报告中明确指出的问题，一条一条逐项解决
2. 不要进行审稿报告未提及的润色或改写
3. 保持原文的风格、节奏和字数体量
4. 对每处修改保持最小变化原则——改得越少越好，只解决问题本身`,
    systemSuffix: `★【作者对本步骤的额外指导（如有，最高优先级）】★：
{{user_refine_prompt}}

请直接输出修复后的全文章节内容。强制要求纯文本，严禁剧本式格式，【严禁】任何开场白、解释文字。
**【强制排版底线】：段落与段落之间必须保留一个空行作为分隔，绝对不允许连续文本不留空行。**`,
    contentLocalized: {
      en: `Please perform a **targeted fix** on the draft based on the issues listed in the review report.

【★★★ Narrative Consistency Canon Context (MUST NOT violate during repair) ★★★】
{{canon_context}}

【Review Report】
{{review_report}}

【Draft to Repair】
{{draft_content}}

【Global Writing Requirements】
{{global_guidance}}

【Repair Principles】
1. Fix ONLY the problems explicitly identified in the review report — address them one by one.
2. Do NOT perform any polishing or rewriting beyond what the review report mentions.
3. Preserve the original's style, pacing, and word count volume.
4. For each change, maintain the principle of minimal change — fix as little as possible, only addressing the problem itself.`,
      ru: `Пожалуйста, выполните **точечный ремонт** черновика на основе проблем, перечисленных в отчёте проверки.

【★★★ Контекст канона нарративной согласованности (НЕ НАРУШАТЬ при ремонте) ★★★】
{{canon_context}}

【Отчёт проверки】
{{review_report}}

【Черновик для ремонта】
{{draft_content}}

【Глобальные требования к написанию】
{{global_guidance}}

【Принципы ремонта】
1. Исправляйте ТОЛЬКО проблемы, явно указанные в отчёте проверки — решайте их по одной.
2. НЕ проводите никакой дополнительной шлифовки или переписывания сверх того, что указано в отчёте.
3. Сохраняйте стиль, темп и объём оригинала.
4. Для каждого изменения соблюдайте принцип минимальных изменений — исправляйте как можно меньше, только устраняя саму проблему.`
    },
    systemRoleLocalized: {
      en: 'You are a meticulous fiction editor, skilled at precisely fixing specific textual issues without over-rewriting.',
      ru: 'Вы — тщательный редактор художественной литературы, искусно точно исправляющий конкретные текстовые проблемы без избыточного переписывания.'
    },
  },



  // ================================================================
  // 章节要点生成（定稿后处理 / 按章推演）
  // ================================================================

  {
    key: 'generate_chapter_notes',
    name: '章节要点生成',
    description: '定稿后为本章生成结构化要点（剧情节点、角色动态、新增设定、伏笔与钩子）',
    systemRole: '你是一位专业的网文结构分析师。',
    variables: {
      chapter_content: '章节正文内容',
      chapter_number: '章节编号',
      chapter_title: '章节标题',
    },
    content: `请为以下章节生成一份精确的【结构化章节要点】。

【章节正文】
第{{chapter_number}}章 {{chapter_title}}
{{chapter_content}}

---

请严格按照以下 Markdown 格式输出，不要添加任何额外说明：

# 第{{chapter_number}}章 要点

## 剧情节点
（列出本章中不可逆的关键剧情进展，使用 [类型] 标注）
- [触发] ...
- [转折] ...
- [结果] ...

## 角色动态
（用表格记录本章出场的主要角色及其变化）
| 角色 | 本章变化/状态 |
|------|-------------|
| 角色名 | 具体变化描述 |

## 新增设定
（本章首次出现或确认的世界观/力量体系/规则，无则省略此节）
- ...

## 伏笔与钩子
（本章埋下的伏笔用 [埋]，章末留给读者的钩子用 [钩]，无则省略此节）
- [埋] ...
- [钩] ...

严格按格式输出，内容精炼，每项不超过 30 字。`,
    contentLocalized: {
      en: `Please generate an accurate set of [Structured Chapter Notes] for the following chapter.

【Chapter Text】
Chapter {{chapter_number}}: {{chapter_title}}
{{chapter_content}}

---

Please output strictly in the following Markdown format without any additional explanation:

# Chapter {{chapter_number}} Notes

## Plot Beats
(List irreversible key plot developments in this chapter, annotated with [Type])
- [Trigger] …
- [Turning Point] …
- [Outcome] …

## Character Dynamics
(Record the main characters appearing this chapter and their changes in a table)
| Character | This Chapter's Change / Status |
|-----------|-------------------------------|
| Character Name | Specific change description |

## New Settings
(World-building / power systems / rules first introduced or confirmed in this chapter; omit if none)
- …

## Foreshadowing & Hooks
(Foreshadowed elements marked [Planted]; cliffhangers left for readers marked [Hook]; omit if none)
- [Planted] …
- [Hook] …

Output strictly in format, keep content concise, each item no more than 30 words.`,
      ru: `Пожалуйста, создайте точный набор [Структурированных заметок к главе] для следующей главы.

【Текст главы】
Глава {{chapter_number}}: {{chapter_title}}
{{chapter_content}}

---

Выведите строго в следующем формате Markdown без каких-либо дополнительных пояснений:

# Заметки к главе {{chapter_number}}

## Сюжетные узлы
(Перечислите необратимые ключевые сюжетные события этой главы с пометкой [Тип])
- [Триггер] …
- [Поворотный момент] …
- [Исход] …

## Динамика персонажей
(Зафиксируйте основных персонажей этой главы и их изменения в таблице)
| Персонаж | Изменение / Статус за эту главу |
|----------|----------------------------------|
| Имя персонажа | Описание конкретного изменения |

## Новые настройки
(Мироздание / системы сил / правила, впервые введённые или подтверждённые в этой главе; опустите, если нет)
- …

## Предвестия и крючки
(Предвестия — пометка [Заложено]; интриги для читателей — пометка [Крючок]; опустите, если нет)
- [Заложено] …
- [Крючок] …

Выводите строго по формату, содержание краткое, каждый пункт не более 30 слов.`
    },
    systemRoleLocalized: {
      en: 'You are a professional web novel structural analyst.',
      ru: 'Вы — профессиональный структурный аналитик веб-романов.'
    },
  },

  // ================================================================
  // 角色卡 currentState 更新（JSON 输出）
  // ================================================================

  {
    key: 'update_character_cards',
    name: '更新角色卡动态状态',
    description: '定稿后分析章节内容，以 JSON 格式返回有变化的角色的 currentState 字段，用于自动更新角色卡',
    systemRole: '你是一位严谨的小说角色档案管理员，擅长追踪角色多维状态变化。',
    variables: {
      chapter_content: '章节正文内容',
      chapter_number: '章节编号',
      existing_cards_json: '现有角色卡 JSON 数组（包含 name/role 等基础信息）',
    },
    content: `请根据章节内容，以 JSON 格式返回在本章中发生状态变化的角色的最新状态。

【本章内容（第{{chapter_number}}章）】
{{chapter_content}}

【现有角色卡（基础信息）】
{{existing_cards_json}}

---

【任务要求】
1. 分析并在 \`updates\` 中提取已有角色（从提供的现有角色卡中找）发生状态变化的信息。
2. 分析并在 \`newCharacters\` 中提取本章新出场的重要角色（不要包含路人或已死无后续影响的龙套）。
3. \`currentState\` 字段说明：
   - location: 当前所在位置/阵营（字符串）
   - powerLevel: 修为境界/能力等级（字符串）
   - physicalState: 身体状态，包括伤势/BUFF/外貌变化（字符串）
   - mentalState: 心理状态，当前愿望/恐惧/心态（字符串）
   - keyItems: 当前持有的关键道具/资源（字符串）
   - recentEvents: 本章发生的最重要事件（字符串，50字以内）
   - updatedAtChapter: 固定填写 {{chapter_number}}（数字）

【输出格式（JSON）】
{
  "updates": [
    {
      "name": "已有角色的精确名字",
      "currentState": {
        "location": "...",
        "powerLevel": "...",
        "physicalState": "...",
        "mentalState": "...",
        "keyItems": "...",
        "recentEvents": "...",
        "updatedAtChapter": {{chapter_number}}
      }
    }
  ],
  "newCharacters": [
    {
      "name": "新角色名字",
      "role": "主要人物/反派/配角/导师",
      "currentState": {
        "location": "...",
        "powerLevel": "...",
        "physicalState": "...",
        "mentalState": "...",
        "keyItems": "...",
        "recentEvents": "...",
        "updatedAtChapter": {{chapter_number}}
      }
    }
  ]
}

如果本章无任何角色发生状态变化且无新角色，返回 {"updates": [], "newCharacters": []}。`,
    contentLocalized: {
      en: `Based on the chapter content, return the latest states of characters who underwent changes in this chapter in JSON format.

【This Chapter's Content (Chapter {{chapter_number}})】
{{chapter_content}}

【Existing Character Cards (Basic Info)】
{{existing_cards_json}}

---

【Task Requirements】
1. Analyze and extract in \`updates\` the state changes of existing characters (found among the provided character cards).
2. Analyze and extract in \`newCharacters\` any important new characters appearing in this chapter (exclude background extras or dead characters with no further impact).
3. \`currentState\` field description:
   - location: current location / faction (string)
   - powerLevel: cultivation level / ability tier (string)
   - physicalState: physical condition including injuries / buffs / appearance changes (string)
   - mentalState: psychological state, current wish / fear / mindset (string)
   - keyItems: currently held key items / resources (string)
   - recentEvents: most important event in this chapter (string, under 50 words)
   - updatedAtChapter: fixed value {{chapter_number}} (number)

【Output Format (JSON)】
{
  "updates": [
    {
      "name": "Exact name of existing character",
      "currentState": {
        "location": "...",
        "powerLevel": "...",
        "physicalState": "...",
        "mentalState": "...",
        "keyItems": "...",
        "recentEvents": "...",
        "updatedAtChapter": {{chapter_number}}
      }
    }
  ],
  "newCharacters": [
    {
      "name": "New character name",
      "role": "protagonist/antagonist/supporting/minor",
      "currentState": {
        "location": "...",
        "powerLevel": "...",
        "physicalState": "...",
        "mentalState": "...",
        "keyItems": "...",
        "recentEvents": "...",
        "updatedAtChapter": {{chapter_number}}
      }
    }
  ]
}

If no characters had state changes and no new characters appeared, return {"updates": [], "newCharacters": []}.`,
      ru: `На основе содержания главы верните в формате JSON最新的 состояния персонажей, которые изменились в этой главе.

【Содержание этой главы (Глава {{chapter_number}})】
{{chapter_content}}

【Существующие карточки персонажей (основная информация)】
{{existing_cards_json}}

---

【Требования к заданию】
1. Проанализируйте и извлеките в \`updates\` изменения состояний существующих персонажей (среди предоставленных карточек).
2. Проанализируйте и извлеките в \`newCharacters\` любых важных новых персонажей, появившихся в этой главе (исключайте фоновых extras или мёртвых персонажей без дальнейшего влияния).
3. Описание поля \`currentState\`:
   - location: текущее местоположение / фракция (строка)
   - powerLevel: уровень культивации / уровень способностей (строка)
   - physicalState: физическое состояние, включая травмы / баффы / внешние изменения (строка)
   - mentalState: психологическое состояние, текущее желание / страх / настрой (строка)
   - keyItems: текущие ключевые предметы / ресурсы (строка)
   - recentEvents: важнейшее событие главы (строка, до 50 слов)
   - updatedAtChapter: фиксированное значение {{chapter_number}} (число)

【Формат вывода (JSON)】
{
  "updates": [
    {
      "name": "Точное имя существующего персонажа",
      "currentState": {
        "location": "...",
        "powerLevel": "...",
        "physicalState": "...",
        "mentalState": "...",
        "keyItems": "...",
        "recentEvents": "...",
        "updatedAtChapter": {{chapter_number}}
      }
    }
  ],
  "newCharacters": [
    {
      "name": "Имя нового персонажа",
      "role": "protagonist/antagonist/supporting/minor",
      "currentState": {
        "location": "...",
        "powerLevel": "...",
        "physicalState": "...",
        "mentalState": "...",
        "keyItems": "...",
        "recentEvents": "...",
        "updatedAtChapter": {{chapter_number}}
      }
    }
  ]
}

Если ни один персонаж не изменил состояние и новых персонажей нет, верните {"updates": [], "newCharacters": []}.`
    },
    systemRoleLocalized: {
      en: 'You are a meticulous novel character file manager, skilled at tracking multi-dimensional state changes across characters.',
      ru: 'Вы — тщательный менеджер файлов персонажей романа, искусно отслеживающий многомерные изменения состояний.'
    },
  },

  // ================================================================
  // 逆向推演 — 从知识库内容反推全局配置（旧作续写）
  // ================================================================

  {
    key: 'infer_novel_config',
    name: '逆向推演全局配置',
    description: '从已有小说内容（知识库采样片段）反推出小说配置、四段架构和主角色卡，用于旧作续写场景',
    systemRole: '你是一位顶级网文主编和资深阅读分析师，擅长从已有作品中逆向推演设定体系。',
    variables: {
      sample_content: '知识库代表性采样内容（开头+中段+结尾）',
    },
    content: `请根据以下已有小说内容片段，逆向推演出这部小说的完整设定体系，用于支持续写工作。

【已有内容样本】
{{sample_content}}

---

请严格按照以下 JSON 格式返回分析结果：

{
  "novelConfig": {
    "genre": "主类型（玄幻/仙侠/都市/科幻/历史/悬疑/游戏/军事/奇幻/武侠/现实/其他）",
    "targetAudience": "受众（男频/女频/通用）",
    "subGenre": "细分类型及标签",
    "coreOutline": "核心大纲（150字以上，含主线目标、核心冲突、故事走向）",
    "worldSetting": "世界观背景与力量体系",
    "goldenFinger": "主角金手指/核心能力体系",
    "protagonistProfile": "主角人设（性格、背景、核心驱动力）",
    "globalGuidance": "根据已有内容归纳的全局写作风格与节奏要求"
  },
  "architectureFiles": {
    "premise": "核心故事前提文本（200字以内的高度浓缩核心）",
    "characters": "已知主要角色的关系网与动力学分析",
    "worldbuilding": "世界观矩阵（力量体系、阶层结构、重要场景）",
    "synopsis": "已知的情节走向分析（含已完成的部分和推测的后续走向）"
  },
  "characterCards": [
    {
      "name": "角色名",
      "role": "protagonist/antagonist/supporting/minor",
      "gender": "性别",
      "age": "年龄或阶段",
      "appearance": "外貌描写",
      "personality": "性格特征",
      "background": "背景故事",
      "abilities": "能力/技能",
      "motivation": "核心动机",
      "relationships": "关系网",
      "arc": "已知成长轨迹",
      "notes": "其他注意事项",
      "currentState": {
        "location": "最后已知位置",
        "powerLevel": "当前境界/能力等级",
        "physicalState": "当前身体状态",
        "mentalState": "当前心理状态",
        "keyItems": "当前持有的关键道具",
        "recentEvents": "最近发生的重要事件",
        "updatedAtChapter": 0
      }
    }
  ]
}

要求：
1. characterCards 仅包含主角和重要配角（3-8人），不要填写次要龙套
2. 所有字段基于内容推断，未能确定的字段填写"（待确认）"
3. currentState 应基于最新内容（结尾采样）推断，不是初始状态`,
    contentLocalized: {
      en: `Based on the following existing novel content excerpts, reverse-engineer the complete setting system of this novel to support continuation work.

【Existing Content Sample】
{{sample_content}}

---

Please return the analysis results strictly in the following JSON format:

{
  "novelConfig": {
    "genre": "Primary genre (fantasy / xianxia / urban / sci-fi / historical / mystery / gaming / military / wuxia / realism / other)",
    "targetAudience": "Target audience (male-oriented / female-oriented / general)",
    "subGenre": "Sub-genre and tags",
    "coreOutline": "Core outline (150+ words, including main-line objective, core conflict, story trajectory)",
    "worldSetting": "World background and power system",
    "goldenFinger": "Protagonist's golden finger / core ability system",
    "protagonistProfile": "Protagonist profile (personality, background, core motivation)",
    "globalGuidance": "Global writing style and pacing requirements inferred from existing content"
  },
  "architectureFiles": {
    "premise": "Core story premise text (under 200 words, highly condensed)",
    "characters": "Known main characters' relationship web and dynamics analysis",
    "worldbuilding": "Worldbuilding matrix (power system, class structure, key locations)",
    "synopsis": "Known plot trajectory analysis (including completed portions and inferred future trajectory)"
  },
  "characterCards": [
    {
      "name": "Character name",
      "role": "protagonist/antagonist/supporting/minor",
      "gender": "Gender",
      "age": "Age or life stage",
      "appearance": "Appearance description",
      "personality": "Personality traits",
      "background": "Backstory",
      "abilities": "Abilities / skills",
      "motivation": "Core motivation",
      "relationships": "Relationship web",
      "arc": "Known growth trajectory",
      "notes": "Other notes",
      "currentState": {
        "location": "Last known location",
        "powerLevel": "Current level / ability tier",
        "physicalState": "Current physical condition",
        "mentalState": "Current psychological state",
        "keyItems": "Currently held key items",
        "recentEvents": "Most recent important events",
        "updatedAtChapter": 0
      }
    }
  ]
}

Requirements:
1. characterCards should only include the protagonist and key supporting characters (3–8), not minor extras.
2. All fields are inferred from the content; undetermined fields should be filled with "(TBD)".
3. currentState should be inferred from the latest content (ending sample), not the initial state.`,
      ru: `На основе следующих отрывков из существующего романа выполните обратное проектирование полной системы настроек этого романа для поддержки работы по продолжению.

【Образец существующего содержания】
{{sample_content}}

---

Выведите результаты анализа строго в следующем формате JSON:

{
  "novelConfig": {
    "genre": "Основной жанр (фэнтези / сянься / городское / научная фантастика / исторический / детектив / игровые / военный / уся / реализм / другое)",
    "targetAudience": "Целевая аудитория (мужская / женская / универсальная)",
    "subGenre": "Поджанр и теги",
    "coreOutline": "Основной конспект (150+ слов, включая главную цель, основной конфликт, траекторию истории)",
    "worldSetting": "Фон мира и система сил",
    "goldenFinger": "Золотой палец героя / система основных способностей",
    "protagonistProfile": "Профиль героя (характер, предыстория, основная мотивация)",
    "globalGuidance": "Глобальные требования к стилю и темпу, выведенные из существующего контента"
  },
  "architectureFiles": {
    "premise": "Текст основной сюжетной посылки (до 200 слов, высоко концентрированный)",
    "characters": "Известная сеть отношений и динамика ключевых персонажей",
    "worldbuilding": "Матрица мироздания (система сил, классовая структура, ключевые локации)",
    "synopsis": "Анализ известной траектории сюжета (включая завершённые части и предполагаемую дальнейшую траекторию)"
  },
  "characterCards": [
    {
      "name": "Имя персонажа",
      "role": "protagonist/antagonist/supporting/minor",
      "gender": "Пол",
      "age": "Возраст или этап жизни",
      "appearance": "Описание внешности",
      "personality": "Черты характера",
      "background": "Предыстория",
      "abilities": "Способности / навыки",
      "motivation": "Основная мотивация",
      "relationships": "Сеть отношений",
      "arc": "Известная траектория развития",
      "notes": "Другие заметки",
      "currentState": {
        "location": "Последнее известное местоположение",
        "powerLevel": "Текущий уровень",
        "physicalState": "Текущее физическое состояние",
        "mentalState": "Текущее психологическое состояние",
        "keyItems": "Текущие ключевые предметы",
        "recentEvents": "Последние важные события",
        "updatedAtChapter": 0
      }
    }
  ]
}

Требования:
1. characterCards должны включать только главного героя и ключевых второстепенных персонажей (3–8), не фоновых extras.
2. Все поля выводятся из содержания; неопределённые поля заполняются «(уточнить)».
3. currentState выводится из самого позднего контента (образец финала), а не из начального состояния.`
    },
    systemRoleLocalized: {
      en: 'You are a top-tier web novel editor and seasoned literary analyst, skilled at reverse-engineering setting systems from existing works.',
      ru: 'Вы — ведущий редактор веб-романов и опытный литературный аналитик, искусно выполняющий обратное проектирование систем настроек из существующих произведений.'
    },
  },

  // ================================================================
  // 架构生成 — 从角色图谱提取初始角色卡
  // ================================================================

  {
    key: 'extract_initial_characters',
    name: '提取初始角色卡',
    description: '从角色图谱纯文本中提取结构化角色卡数据，用于架构生成后自动创建角色卡 JSON 文件',
    systemRole: '你是一位专业的小说数据结构化专家。',
    variables: {
      character_dynamics: '角色图谱纯文本',
      genre: '小说类型',
    },
    content: `请从以下角色图谱文本中提取所有重要角色的结构化信息。

【角色图谱文本】
{{character_dynamics}}

【小说类型】
{{genre}}

【任务要求】
1. 提取所有在图谱中明确描述的角色（主角、反派、重要配角），不要遗漏。
2. 龙套或仅一笔带过的角色不用提取。
3. 所有字段基于图谱内容提取。如果图谱中未明确描写外貌，请务必根据角色的身份背景与性格推测并补充一段丰满的标志性外貌描写（外貌特征绝对不要留空或写未知）。未能确定的其他次要字段可填写空字符串。
4. role 字段仅限以下取值：protagonist（主角）、antagonist（反派）、supporting（配角）、minor（龙套）。
5. currentState 是角色的初始状态（故事开始时），updatedAtChapter 固定为 0。

【输出格式】
必须返回一个 JSON 对象，格式如下（characters 数组包含所有角色）：
{
  "characters": [
    {
      "name": "角色名",
      "role": "protagonist",
      "gender": "性别",
      "age": "年龄或年龄段",
      "appearance": "外貌特征",
      "personality": "性格特点",
      "background": "背景故事",
      "abilities": "能力/技能/修为",
      "motivation": "核心动机与渴望",
      "relationships": "与其他角色的关系",
      "arc": "预期的角色弧光/成长轨迹",
      "notes": "其他补充说明",
      "currentState": {
        "location": "初始位置",
        "powerLevel": "初始境界/能力等级",
        "physicalState": "初始身体状态",
        "mentalState": "初始心理状态",
        "keyItems": "初始持有道具",
        "recentEvents": "故事开始前的背景事件",
        "updatedAtChapter": 0
      }
    }
  ]
}

如果图谱中没有任何可提取的角色，返回 {"characters": []}。`,
    contentLocalized: {
      en: `Please extract all important characters' structured information from the following character dynamics text.

【Character Dynamics Text】
{{character_dynamics}}

【Novel Genre】
{{genre}}

【Task Requirements】
1. Extract all clearly described characters in the dynamics (protagonist, antagonist, key supporting characters) — do not omit any.
2. Do not extract background extras or characters mentioned only in passing.
3. All fields are extracted from the dynamics text. If the dynamics do not explicitly describe appearance, you MUST infer and provide a rich signature appearance description based on the character's background and personality (appearance must NEVER be left blank or marked as unknown). Other minor fields that cannot be determined may be left as empty strings.
4. The role field may only have these values: protagonist, antagonist, supporting, minor.
5. currentState represents the character's initial state (at story start); updatedAtChapter is fixed at 0.

【Output Format】
Must return a JSON object in the following format (characters array contains all characters):
{
  "characters": [
    {
      "name": "Character name",
      "role": "protagonist",
      "gender": "Gender",
      "age": "Age or age range",
      "appearance": "Physical description",
      "personality": "Personality traits",
      "background": "Backstory",
      "abilities": "Abilities / skills / cultivation",
      "motivation": "Core motivation and desires",
      "relationships": "Relationships with other characters",
      "arc": "Expected character arc / growth trajectory",
      "notes": "Other supplementary notes",
      "currentState": {
        "location": "Initial location",
        "powerLevel": "Initial level / ability tier",
        "physicalState": "Initial physical condition",
        "mentalState": "Initial psychological state",
        "keyItems": "Initially held items",
        "recentEvents": "Background events before story start",
        "updatedAtChapter": 0
      }
    }
  ]
}

If the dynamics contain no extractable characters, return {"characters": []}.`,
      ru: `Пожалуйста, извлеките всю структурированную информацию о важных персонажах из следующего текста динамики персонажей.

【Текст динамики персонажей】
{{character_dynamics}}

【Жанр романа】
{{genre}}

【Требования к заданию】
1. Извлеките всех чётко описанных персонажей (главного героя, антагониста, ключевых второстепенных) — не пропускайте ни одного.
2. Не извлекайте фоновых extras или персонажей, упомянутых лишь мимоходом.
3. Все поля извлекаются из текста динамики. Если динамика не описывает внешность, вы ОБЯЗАНЫ вывести и предоставить богатое описание характерной внешности на основе предыстории и характера персонажа (внешность НИКОГДА не должна оставаться пустой или помечаться как неизвестная). Другие второстепенные поля, которые невозможно определить, могут быть оставлены пустыми строками.
4. Поле role может принимать только значения: protagonist, antagonist, supporting, minor.
5. currentState отражает начальное состояние персонажа (в начале истории); updatedAtChapter фиксируется на 0.

【Формат вывода】
Обязательно верните объект JSON в следующем формате (массив characters содержит всех персонажей):
{
  "characters": [
    {
      "name": "Имя персонажа",
      "role": "protagonist",
      "gender": "Пол",
      "age": "Возраст или возрастная категория",
      "appearance": "Описание внешности",
      "personality": "Черты характера",
      "background": "Предыстория",
      "abilities": "Способности / навыки / уровень культивации",
      "motivation": "Основная мотивация и желания",
      "relationships": "Отношения с другими персонажами",
      "arc": "Ожидаемая арка персонажа / траектория развития",
      "notes": "Другие дополнительные заметки",
      "currentState": {
        "location": "Начальное местоположение",
        "powerLevel": "Начальный уровень",
        "physicalState": "Начальное физическое состояние",
        "mentalState": "Начальное психологическое состояние",
        "keyItems": "Начальные предметы",
        "recentEvents": "Предысторические события до начала истории",
        "updatedAtChapter": 0
      }
    }
  ]
}

Если в динамике нет извлекаемых персонажей, верните {"characters": []}.`
    },
    systemRoleLocalized: {
      en: 'You are a professional novel data structuring expert.',
      ru: 'Вы — профессиональный эксперт по структурированию данных романа.'
    },
  },

  // ================================================================
  // 逆向推演 — 按章蓝图精准推演（导入已有小说用）
  // ================================================================

  {
    key: 'infer_single_chapter_blueprint',
    name: '逆向推演单章蓝图',
    description: '从已有小说章节正文高精度反推出该章的结构化蓝图信息，用于导入旧作场景',
    systemRole: '你是一位专业的网文结构分析师，擅长从正文中提取结构化蓝图信息。',
    variables: {
      chapter_content: '本章正文全文',
      chapter_number: '本章序号',
      chapter_title: '本章标题（来自拆章）',
      novel_config_summary: '全局配置脱水版',
    },
    content: `请阅读以下已有章节正文，从中提取结构化蓝图信息。

【全局小说设定概要】
{{novel_config_summary}}

【章节信息】
- 章节序号：第 {{chapter_number}} 章
- 拆章标题：{{chapter_title}}

【本章正文】
{{chapter_content}}

---

请严格按以下 JSON 格式输出本章蓝图：

{
  "chapterNumber": {{chapter_number}},
  "title": "从正文内容中提炼的精准章节标题（如果拆章标题已经不错可保留）",
  "role": "本章在全书中的角色（起、承、转、合、伏笔、高潮、过渡 等）",
  "purpose": "本章主角最想解决的核心问题（一句话）",
  "characters": ["本章出场的重要角色名"],
  "keyEvents": "本章核心事件概述（100-150字，包含因果关系和结果）",
  "suspenseHook": "章末留下的悬念或钩子（一句话）"
}

要求：
1. keyEvents 必须基于正文实际内容提取，不可臆造。
2. characters 只列主要互动角色名（3-5个），不要列龙套。
3. role 从正文的叙事功能判断（建置/发展/转折/高潮/结局/过渡等）。
4. 仅输出 JSON，不要任何额外文字。`,
    contentLocalized: {
      en: `Please read the following existing chapter text and extract structured blueprint information from it.

【Global Novel Setting Summary】
{{novel_config_summary}}

【Chapter Info】
- Chapter number: {{chapter_number}}
- Split chapter title: {{chapter_title}}

【This Chapter's Full Text】
{{chapter_content}}

---

Please output this chapter's blueprint strictly in the following JSON format:

{
  "chapterNumber": {{chapter_number}},
  "title": "Precise chapter title distilled from the text (retain if the split title is already good)",
  "role": "This chapter's role in the overall novel (setup / development / turning point / climax / resolution / transition, etc.)",
  "purpose": "The core problem the protagonist most wants to solve this chapter (one sentence)",
  "characters": ["Important character names appearing in this chapter"],
  "keyEvents": "Summary of core events in this chapter (100–150 words, including cause-and-effect and outcome)",
  "suspenseHook": "Cliffhanger or hook left at the end (one sentence)"
}

Requirements:
1. keyEvents must be extracted from the actual text — do not fabricate.
2. characters should only list main interacting characters (3–5), not extras.
3. role is determined by the narrative function in the text (setup / development / turning point / climax / resolution / transition, etc.).
4. Output only JSON — no additional text.`,
      ru: `Пожалуйста, прочитайте следующий текст существующей главы и извлеките из него структурированную информацию о плане.

【Общая сводка настроек романа】
{{novel_config_summary}}

【Информация о главе】
- Номер главы: {{chapter_number}}
- Заголовок по разбиению: {{chapter_title}}

【Полный текст этой главы】
{{chapter_content}}

---

Выведите план этой главы строго в следующем формате JSON:

{
  "chapterNumber": {{chapter_number}},
  "title": "Точный заголовок главы, извлечённый из текста (сохраните, если заголовок по разбиению уже хорош)",
  "role": "Роль этой главы в общем романе (завязка / развитие / поворотный момент / кульминация / развязка / переход и т.д.)",
  "purpose": "Основная проблема, которую герой хочет решить в этой главе (одно предложение)",
  "characters": ["Имена важных персонажей, появляющихся в этой главе"],
  "keyEvents": "Краткое изложение основных событий главы (100–150 слов, включая причинно-следственные связи и результат)",
  "suspenseHook": "Интрига или крючок, оставленный в конце (одно предложение)"
}

Требования:
1. keyEvents должны быть извлечены из фактического текста — не придумывайте.
2. characters должны включать только основных взаимодействующих персонажей (3–5), не фоновых extras.
3. role определяется повествовательной функцией в тексте (завязка / развитие / поворотный момент / кульминация / развязка / переход и т.д.).
4. Выводите только JSON — никакого дополнительного текста.`
    },
    systemRoleLocalized: {
      en: 'You are a professional web novel structural analyst, skilled at extracting structured blueprint information from prose.',
      ru: 'Вы — профессиональный структурный аналитик веб-романов, искусно извлекающий структурированную информацию о плане из прозы.'
    },
  },

  // ================================================================
  // 逆向推演 — 向量采样增强版配置推演（导入已有小说用）
  // ================================================================

  {
    key: 'infer_novel_config_with_vectors',
    name: '向量采样增强推演',
    description: '利用向量检索采样的精确内容片段，增强全局配置推演的准确度',
    systemRole: '你是一位顶级网文主编和资深阅读分析师，擅长从已有作品中逆向推演设定体系。',
    variables: {
      sampled_worldview: '向量检索：世界观与力量体系相关片段',
      sampled_protagonist: '向量检索：主角设定与金手指相关片段',
      sampled_conflict: '向量检索：核心矛盾与敌对势力相关片段',
      sampled_style: '向量检索：写作风格与叙事视角相关片段',
      first_chapter: '第一章正文（开局风格参考）',
      latest_chapter: '最新一章正文（当前进度参考）',
      total_chapters: '已有总章数',
    },
    content: `请根据以下从小说中精准提取的关键片段，逆向推演出这部小说的完整设定体系。

【第一章正文（开局风格参考）】
{{first_chapter}}

【最新一章正文（当前进度参考）】
{{latest_chapter}}

【总章数】{{total_chapters}} 章

【向量检索精选片段 — 世界观与力量体系】
{{sampled_worldview}}

【向量检索精选片段 — 主角设定与金手指】
{{sampled_protagonist}}

【向量检索精选片段 — 核心矛盾与敌对势力】
{{sampled_conflict}}

【向量检索精选片段 — 写作风格与叙事手法】
{{sampled_style}}

---

请严格按照以下 JSON 格式返回分析结果：

{
  "novelConfig": {
    "genre": "主类型（玄幻/仙侠/都市/科幻/历史/悬疑/游戏/军事/奇幻/武侠/现实/其他）",
    "targetAudience": "受众（男频/女频/通用）",
    "subGenre": "细分类型及标签",
    "plotStructure": "故事结构（three_act/heros_journey/save_the_cat/kishotenketsu/multi_thread/freeform）",
    "narrativePOV": "叙事视角（third_limited/first_person/third_omniscient/multi_pov）",
    "coreOutline": "核心大纲（150字以上，含主线目标、核心冲突、故事走向）",
    "worldSetting": "世界观背景与力量体系",
    "goldenFinger": "主角金手指/核心能力体系",
    "protagonistProfile": "主角人设（性格、背景、核心驱动力）",
    "globalGuidance": "根据已有内容归纳的全局写作风格与节奏要求"
  },
  "architectureFiles": {
    "premise": "核心故事前提文本（200字以内的高度浓缩核心）",
    "characters": "已知主要角色的关系网与动力学分析",
    "worldbuilding": "世界观矩阵（力量体系、阶层结构、重要场景）",
    "synopsis": "已知的情节走向分析（含已完成的部分和推测的后续走向）"
  },
  "characterCards": [
    {
      "name": "角色名",
      "role": "protagonist/antagonist/supporting/minor",
      "gender": "性别",
      "age": "年龄或阶段",
      "appearance": "外貌描写",
      "personality": "性格特征",
      "background": "背景故事",
      "abilities": "能力/技能",
      "motivation": "核心动机",
      "relationships": "关系网",
      "arc": "已知成长轨迹",
      "notes": "其他注意事项",
      "currentState": {
        "location": "最后已知位置",
        "powerLevel": "当前境界/能力等级",
        "physicalState": "当前身体状态",
        "mentalState": "当前心理状态",
        "keyItems": "当前持有的关键道具",
        "recentEvents": "最近发生的重要事件",
        "updatedAtChapter": 0
      }
    }
  ]
}

要求：
1. characterCards 仅包含主角和重要配角（3-8人），不要填写次要龙套
2. 所有字段基于检索片段推断，未能确定的填写"（待确认）"
3. currentState 应基于最新章节推断当前状态，而非初始状态
4. plotStructure 和 narrativePOV 请根据实际叙事特征判断，而非猜测`,
    contentLocalized: {
      en: `Based on the following precisely extracted key passages from the novel, reverse-engineer the complete setting system of this novel.

【Chapter 1 Full Text (opening style reference)】
{{first_chapter}}

【Latest Chapter Full Text (current progress reference)】
{{latest_chapter}}

【Total chapters】{{total_chapters}}

【Vector Search Selected Passages — Worldbuilding & Power System】
{{sampled_worldview}}

【Vector Search Selected Passages — Protagonist Settings & Golden Finger】
{{sampled_protagonist}}

【Vector Search Selected Passages — Core Conflicts & Antagonist Forces】
{{sampled_conflict}}

【Vector Search Selected Passages — Writing Style & Narrative Techniques】
{{sampled_style}}

---

Please return the analysis results strictly in the following JSON format:

{
  "novelConfig": {
    "genre": "Primary genre (fantasy / xianxia / urban / sci-fi / historical / mystery / gaming / military / wuxia / realism / other)",
    "targetAudience": "Target audience (male-oriented / female-oriented / general)",
    "subGenre": "Sub-genre and tags",
    "plotStructure": "Story structure (three_act / heros_journey / save_the_cat / kishotenketsu / multi_thread / freeform)",
    "narrativePOV": "Narrative POV (third_limited / first_person / third_omniscient / multi_pov)",
    "coreOutline": "Core outline (150+ words, including main-line objective, core conflict, story trajectory)",
    "worldSetting": "World background and power system",
    "goldenFinger": "Protagonist's golden finger / core ability system",
    "protagonistProfile": "Protagonist profile (personality, background, core motivation)",
    "globalGuidance": "Global writing style and pacing requirements inferred from existing content"
  },
  "architectureFiles": {
    "premise": "Core story premise text (under 200 words, highly condensed)",
    "characters": "Known main characters' relationship web and dynamics analysis",
    "worldbuilding": "Worldbuilding matrix (power system, class structure, key locations)",
    "synopsis": "Known plot trajectory analysis (including completed portions and inferred future trajectory)"
  },
  "characterCards": [
    {
      "name": "Character name",
      "role": "protagonist/antagonist/supporting/minor",
      "gender": "Gender",
      "age": "Age or life stage",
      "appearance": "Appearance description",
      "personality": "Personality traits",
      "background": "Backstory",
      "abilities": "Abilities / skills",
      "motivation": "Core motivation",
      "relationships": "Relationship web",
      "arc": "Known growth trajectory",
      "notes": "Other notes",
      "currentState": {
        "location": "Last known location",
        "powerLevel": "Current level / ability tier",
        "physicalState": "Current physical condition",
        "mentalState": "Current psychological state",
        "keyItems": "Currently held key items",
        "recentEvents": "Most recent important events",
        "updatedAtChapter": 0
      }
    }
  ]
}

Requirements:
1. characterCards should only include the protagonist and key supporting characters (3–8), not minor extras.
2. All fields are inferred from the retrieved passages; undetermined fields should be filled with "(TBD)".
3. currentState should be inferred from the latest chapter, not the initial state.
4. Determine plotStructure and narrativePOV based on actual narrative characteristics, not guesses.`,
      ru: `На основе следующих точно извлечённых ключевых отрывков из романа выполните обратное проектирование полной системы настроек этого романа.

【Полный текст Главы 1 (образец начального стиля)】
{{first_chapter}}

【Полный текст последней главы (образец текущего прогресса)】
{{latest_chapter}}

【Общее количество глав】{{total_chapters}}

【Избранные отрывки из векторного поиска — Мироздание и система сил】
{{sampled_worldview}}

【Избранные отрывки из векторного поиска — Настройки героя и золотой палец】
{{sampled_protagonist}}

【Избранные отрывки из векторного поиска — Основные конфликты и противостоящие силы】
{{sampled_conflict}}

【Избранные отрывки из векторного поиска — Стиль написания и повествовательные приёмы】
{{sampled_style}}

---

Выведите результаты анализа строго в следующем формате JSON:

{
  "novelConfig": {
    "genre": "Основной жанр (фэнтези / сянься / городское / научная фантастика / исторический / детектив / игровые / военный / уся / реализм / другое)",
    "targetAudience": "Целевая аудитория (мужская / женская / универсальная)",
    "subGenre": "Поджанр и теги",
    "plotStructure": "Структура истории (three_act / heros_journey / save_the_cat / kishotenketsu / multi_thread / freeform)",
    "narrativePOV": "Точка зрения повествования (third_limited / first_person / third_omniscient / multi_pov)",
    "coreOutline": "Основной конспект (150+ слов, включая главную цель, основной конфликт, траекторию истории)",
    "worldSetting": "Фон мира и система сил",
    "goldenFinger": "Золотой палец героя / система основных способностей",
    "protagonistProfile": "Профиль героя (характер, предыстория, основная мотивация)",
    "globalGuidance": "Глобальные требования к стилю и темпу, выведенные из существующего контента"
  },
  "architectureFiles": {
    "premise": "Текст основной сюжетной посылки (до 200 слов, высоко концентрированный)",
    "characters": "Известная сеть отношений и динамика ключевых персонажей",
    "worldbuilding": "Матрица мироздания (система сил, классовая структура, ключевые локации)",
    "synopsis": "Анализ известной траектории сюжета (включая завершённые части и предполагаемую дальнейшую траекторию)"
  },
  "characterCards": [
    {
      "name": "Имя персонажа",
      "role": "protagonist/antagonist/supporting/minor",
      "gender": "Пол",
      "age": "Возраст или этап жизни",
      "appearance": "Описание внешности",
      "personality": "Черты характера",
      "background": "Предыстория",
      "abilities": "Способности / навыки",
      "motivation": "Основная мотивация",
      "relationships": "Сеть отношений",
      "arc": "Известная траектория развития",
      "notes": "Другие заметки",
      "currentState": {
        "location": "Последнее известное местоположение",
        "powerLevel": "Текущий уровень",
        "physicalState": "Текущее физическое состояние",
        "mentalState": "Текущее психологическое состояние",
        "keyItems": "Текущие ключевые предметы",
        "recentEvents": "Последние важные события",
        "updatedAtChapter": 0
      }
    }
  ]
}

Требования:
1. characterCards должны включать только главного героя и ключевых второстепенных персонажей (3–8), не фоновых extras.
2. Все поля выводятся из полученных отрывков; неопределённые поля заполняются «(уточнить)».
3. currentState выводится из последней главы, а не из начального состояния.
4. Определите plotStructure и narrativePOV на основе фактических повествовательных характеристик, а не догадок.`
    },
    systemRoleLocalized: {
      en: 'You are a top-tier web novel editor and seasoned literary analyst, skilled at reverse-engineering setting systems from existing works.',
      ru: 'Вы — ведущий редактор веб-романов и опытный литературный аналитик, искусно выполняющий обратное проектирование систем настроек из существующих произведений.'
    },
  },
]

/** 全局自定义覆盖 Prompt 缓存（~/.vela/prompts/） */
const customPrompts: Map<string, PromptTemplate> = new Map()
let customPromptsLoaded = false

/** 项目级自定义覆盖 Prompt 缓存（{project}/.vela/prompts/） */
const projectCustomPrompts: Map<string, PromptTemplate> = new Map()

/** 加载全局自定义 Prompt 覆盖（从 ~/.vela/prompts/ 目录） */
export async function loadCustomPrompts(): Promise<void> {
  try {
    const { ipc } = await import('./ipc-client')
    if (!ipc.isElectron) return

    const velaHome = await ipc.invoke('config:get-vela-home')
    const promptsDir = `${velaHome}/prompts`

    await _loadPromptsFromDir(promptsDir, customPrompts)
    customPromptsLoaded = true
    console.log(`[Vela Prompts] 已加载 ${customPrompts.size} 个全局自定义覆盖`)
  } catch {
    // prompts 目录可能不存在，忽略
    customPromptsLoaded = true
  }
}

/** 加载项目级自定义 Prompt 覆盖（从 {projectPath}/.vela/prompts/ 目录） */
export async function loadProjectCustomPrompts(projectPath: string): Promise<void> {
  try {
    projectCustomPrompts.clear()
    const promptsDir = `${projectPath}/.vela/prompts`

    await _loadPromptsFromDir(promptsDir, projectCustomPrompts)
    console.log(`[Vela Prompts] 已加载 ${projectCustomPrompts.size} 个项目级自定义覆盖`)
  } catch {
    // 目录不存在时忽略
  }
}

/** 内部工具：从目录加载 JSON 覆盖到指定 Map */
async function _loadPromptsFromDir(dirPath: string, target: Map<string, PromptTemplate>): Promise<void> {
  const { ipc } = await import('./ipc-client')
  const exists = await ipc.invoke('fs:check-exists', dirPath)
  if (!exists) return

  const files = await ipc.invoke('fs:list-dir', dirPath)
  const jsonFiles = files.filter((f) => !f.isDir && f.name.endsWith('.json'))

  for (const file of jsonFiles) {
    const result = await ipc.invoke('fs:read-file', file.path)
    if (result.success && result.content.trim()) {
      try {
        const custom = JSON.parse(result.content) as PromptTemplate
        if (custom.key) {
          target.set(custom.key, custom)
        }
      } catch { /* 忽略无效 JSON */ }
    }
  }
}

/** 根据 key 获取 Prompt 模板（三级优先级：项目级 > 全局级 > 内置） */
export function getPromptTemplate(key: string): PromptTemplate | undefined {
  // 优先级 1：项目级自定义覆盖
  const projectCustom = projectCustomPrompts.get(key)
  if (projectCustom) return projectCustom

  // 优先级 2：全局自定义覆盖
  if (customPromptsLoaded) {
    const globalCustom = customPrompts.get(key)
    if (globalCustom) return globalCustom
  }

  // 优先级 3：内置默认
  return BUILTIN_PROMPTS.find((p) => p.key === key)
}

/** 获取指定模板当前生效的来源 */
export function getPromptSource(key: string): 'builtin' | 'global' | 'project' {
  if (projectCustomPrompts.has(key)) return 'project'
  if (customPromptsLoaded && customPrompts.has(key)) return 'global'
  return 'builtin'
}

/** 获取所有模板（合并自定义，保留三级覆盖优先级） */
export function getAllPromptTemplates(): PromptTemplate[] {
  const all = [...BUILTIN_PROMPTS]
  // 用全局自定义覆盖同名内置模板
  for (const [key, custom] of customPrompts) {
    const idx = all.findIndex((p) => p.key === key)
    if (idx >= 0) {
      all[idx] = custom
    } else {
      all.push(custom)
    }
  }
  // 用项目级自定义覆盖
  for (const [key, custom] of projectCustomPrompts) {
    const idx = all.findIndex((p) => p.key === key)
    if (idx >= 0) {
      all[idx] = custom
    } else {
      all.push(custom)
    }
  }
  return all
}

/** 保存全局自定义 Prompt 到 ~/.vela/prompts/ */
export async function saveCustomPrompt(template: PromptTemplate): Promise<boolean> {
  try {
    const { ipc } = await import('./ipc-client')
    const velaHome = await ipc.invoke('config:get-vela-home')
    const dirPath = `${velaHome}/prompts`
    // 确保目录存在
    const exists = await ipc.invoke('fs:check-exists', dirPath)
    if (!exists) await ipc.invoke('fs:mkdir', dirPath)
    const filePath = `${dirPath}/${template.key}.json`

    await ipc.invoke('fs:write-file', filePath, JSON.stringify(template, null, 2))
    customPrompts.set(template.key, template)
    return true
  } catch {
    return false
  }
}

/** 保存项目级自定义 Prompt 到 {projectPath}/.vela/prompts/ */
export async function saveProjectCustomPrompt(projectPath: string, template: PromptTemplate): Promise<boolean> {
  try {
    const { ipc } = await import('./ipc-client')
    const dirPath = `${projectPath}/.vela/prompts`
    // 确保目录存在
    const exists = await ipc.invoke('fs:check-exists', dirPath)
    if (!exists) {
      await ipc.invoke('fs:mkdir', `${projectPath}/.vela`)
      await ipc.invoke('fs:mkdir', dirPath)
    }
    const filePath = `${dirPath}/${template.key}.json`

    await ipc.invoke('fs:write-file', filePath, JSON.stringify(template, null, 2))
    projectCustomPrompts.set(template.key, template)
    return true
  } catch {
    return false
  }
}

/** 删除全局自定义 Prompt（恢复为内置版本） */
export async function deleteCustomPrompt(key: string): Promise<boolean> {
  try {
    const { ipc } = await import('./ipc-client')
    const velaHome = await ipc.invoke('config:get-vela-home')
    const filePath = `${velaHome}/prompts/${key}.json`
    const exists = await ipc.invoke('fs:check-exists', filePath)
    if (exists) await ipc.invoke('fs:write-file', filePath, '')
    customPrompts.delete(key)
    return true
  } catch {
    return false
  }
}

/** 删除项目级自定义 Prompt（恢复为全局/内置版本） */
export async function deleteProjectCustomPrompt(projectPath: string, key: string): Promise<boolean> {
  try {
    const { ipc } = await import('./ipc-client')
    const filePath = `${projectPath}/.vela/prompts/${key}.json`
    const exists = await ipc.invoke('fs:check-exists', filePath)
    if (exists) await ipc.invoke('fs:write-file', filePath, '')
    projectCustomPrompts.delete(key)
    return true
  } catch {
    return false
  }
}

/** 渲染 Prompt 模板（填充变量 + 自动追加内置 systemSuffix + 空段落裁剪） */
export function renderPrompt(template: PromptTemplate, variables: Record<string, string>): string {
  let content = getLocalizedContent(template)
  for (const [key, value] of Object.entries(variables)) {
    content = content.replaceAll(`{{${key}}}`, value)
  }

  // 自动追加系统约束（始终从内置模板获取，不受用户自定义影响）
  const builtinTemplate = BUILTIN_PROMPTS.find(p => p.key === template.key)
  const suffix = builtinTemplate ? getLocalizedSystemSuffix(builtinTemplate) : undefined
  if (suffix) {
    let renderedSuffix = suffix
    for (const [key, value] of Object.entries(variables)) {
      renderedSuffix = renderedSuffix.replaceAll(`{{${key}}}`, value)
    }
    content = content + '\n\n' + renderedSuffix
  }

  // 空变量段落裁剪：当可选变量为空时，清除残留的空标签段落，避免分散 LLM 注意力
  content = content
    .replace(/\n★【[^】]*】★[：:]\s*\n?\s*$/gm, '')   // 清除空的 ★【...】★ 标签行
    .replace(/\n【[^】]*（如有[^）]*）[^】]*】\s*\n?\s*$/gm, '') // 清除空的 【...如有...】 标签行
    .replace(/\n{3,}/g, '\n\n') // 合并多余空行

  return content
}
