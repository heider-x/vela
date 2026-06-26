# Narrative Consistency（叙事一致性）模块

修复长篇小说生成时的叙事状态管理问题：前言与正文不衔接、人物行为前后矛盾、时间线混乱、地点/关系/知识在不同章节间无解释回退。

## 架构概览

```
narrative-consistency/
├── types.ts          # 类型定义：CanonContext / TimelineEvent / CharacterStateSnapshot / PlotLine / Fact
├── canon-store.ts    # IPC 门面：包装所有 db:canon-* 调用（timeline/state/plot/fact/summary）
├── context-builder.ts# 按固定优先级构造 CanonContext，注入 prompt
├── validator.ts      # 6 维一致性检查（location/knowledge/timeline/relationship/item/continuity）
├── auto-fix.ts       # 高置信度自动修复（knowledge leak + location jump），失败降级为 warning
├── fact-extractor.ts # 定稿时从正文提取结构化事件/角色 delta/剧情线/事实
├── index.ts          # 统一门面
└── __tests__/
    ├── self-contained.test.mjs  # 24 个纯算法测试（不需 npm）
    ├── narrative-consistency.test.ts # vitest 入口（有依赖环境）
    └── standalone.test.ts        # Node test 入口
```

## 数据流

```
生成/修稿 ──► buildCanonContext() ──► renderCanonContext() ──► withCanonContext()
                                                       │
                                                       ▼
                                                  LLM 生成
                                                       │
                                                       ▼
                                              validateChapter()
                                                       │
                                       ┌───────────────┴───────────────┐
                                       ▼                               ▼
                                  tryAutoFix()                  issuesToWarnings()
                                       │                               │
                                       └───────────────┬───────────────┘
                                                       ▼
                                              db:draft-create
                                                       │
                                                       ▼ (定稿时)
                                              extractAndWriteback()
                                                       │
                                                       ▼
                                              CanonStore.writeback()
                                                       │
                                                       ▼
                                              canon_timeline_events / canon_character_state /
                                              canon_plot_lines / canon_facts / canon_chapter_summaries
```

## 5 类叙事错误的修复映射

| 错误类型 | 修复点 | 文件 |
|---|---|---|
| 前言与正文不衔接 | CanonContext.previousEnding 注入 + checkPreviousEndingContinuity | context-builder.ts, validator.ts |
| 人物行为前后矛盾 | CanonContext.characterStates 注入 + CharacterState 写回 + checkRewriteFactSafety | context-builder.ts, canon-store.ts, validator.ts |
| 人物时间线混乱 | CanonContext.timeline 注入 + TimelineEvent 写回 + checkTimelineOrder | context-builder.ts, fact-extractor.ts, validator.ts |
| 人物凭空知道信息 | CanonContext.characterStates[].knowledge 注入 + checkKnowledgeAuthorization | context-builder.ts, validator.ts |
| 地点/关系/物品无解释跳变 | checkLocationContinuity + checkRelationshipContinuity + checkItemOwnership | validator.ts |
| rewrite/refine 破坏事实 | isRewrite=true + checkRewriteFactSafety + 自动修复（knowledge leak + location jump） | validator.ts, auto-fix.ts |
| 新章节不继承历史状态 | CanonStore.writeback 在定稿时写回 timeline/state/fact/plot/summary | fact-extractor.ts, canon-store.ts |

## 测试结果

```
$ node __tests__/self-contained.test.mjs
ok 1 - 1.1 合法转场（来到/前往/到达）不应被报告
ok 2 - 1.2 同一地点不应触发瞬移警告
ok 3 - 1.3 无解释的地点瞬移应被报告为 warning
ok 4 - 1.4 泛指代词不应误触发地点检查
ok 5 - 2.1 canon knowledge 列表中已有的信息不应被警告
ok 6 - 2.2 canon knowledge 中未记录的信息应被警告
ok 7 - 2.3 记得/记忆 视为合法回忆（不警告）
ok 8 - 2.4 非人物名字不应被纳入检查
ok 9 - 3.1 与 canon 一致的关系词不应被警告
ok 10 - 3.2 与 canon 矛盾的关系词应被警告
ok 11 - 3.3 未涉及已知关系对的内容不应触发警告
ok 12 - 4.1 canon 中单调递增的 sequence 不应被警告
ok 13 - 4.2 canon 中 sequence 倒退应被检测为 error
ok 14 - 4.3 闪回章节不应触发时间顺序检查
ok 15 - 5.1 精修后的内容让已死亡角色复活应被检测为 error
ok 16 - 5.2 闪回标记内的死亡角色不应被误报
ok 17 - 5.3 精修未破坏既有事实时应无 error
ok 18 - 集成 1: validateChapter 应聚合多个维度的 issue
ok 19 - 集成 2: tryAutoFix 应对 knowledge leak 进行高置信度修复
ok 20 - 集成 3: error 级别 issue 不应被自动修复
ok 21 - 物品 1: canon 归属人正常使用物品不应触发警告
ok 22 - 物品 2: 他人使用 canon 归属物品应触发提示
ok 23 - 衔接 1: 本章开头承接上一章人物应通过
ok 24 - 衔接 2: 本章开头无上一章人物应触发提示
# tests 24  # pass 24  # fail 0
```

## 数据库迁移

新增 5 张表（`electron/database.ts`，全部 `CREATE TABLE IF NOT EXISTS`，老库零迁移成本）：

- `canon_timeline_events`：结构化时间线事件
- `canon_character_state`：角色当前状态（每角色 1 行）
- `canon_plot_lines`：长期未结剧情线
- `canon_facts`：客观事实条目
- `canon_chapter_summaries`：章节摘要

新增 16 条 IPC 通道（`electron/controllers/db-controller.ts`）：

```
db:canon-timeline-get / get-chapter / append / clear-chapter
db:canon-character-state-get-all / get / upsert
db:canon-plot-list / add / advance / resolve
db:canon-fact-list / add / clear-chapter
db:canon-summary-get / list-recent / upsert
```

## 注入顺序（CanonContext 优先级）

```
1. 正史设定（不可违背）
2. 人物群像（静态设定）
3. 当前人物状态（最高优先级 · 生成时不得推翻）
4. 已发生事件时间线（严格单向）
5. 最近章节摘要
6. 未结剧情线
7. 关键事实条目
8. 上一章结尾（衔接）
9. 本章写作目标
10. 知识库参考（最低优先级）
11. 文风要求
12. 全局行文指导
13. 硬性约束（不可违反）
```

## 自动修复策略（保守）

| 问题类别 | severity | 自动修复？ | 修复方式 |
|---|---|---|---|
| knowledge 越权 | warning | ✅ | 在 evidence 前插入「（据前文线索）」 |
| location 瞬移 | warning | ❌ | 降级为 warning（避免破坏原文节奏） |
| relationship 矛盾 | warning | ❌ | 降级为 warning |
| timeline 倒退 | error | ❌ | 强制留为 warning（提示人工） |
| 已死亡角色复活 | error | ❌ | 强制留为 warning（提示人工） |

`error` 级别一律不自动修复，避免引入新的错误。
