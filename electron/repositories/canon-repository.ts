/**
 * CanonRepository —— 叙事一致性 Canon Store
 *
 * 5 张新表：
 *   canon_timeline_events —— 结构化时间线事件（chapterNumber, sequence, ...）
 *   canon_character_state  —— 角色当前状态（每角色 1 行，upsert）
 *   canon_plot_lines       —— 长期未结剧情线
 *   canon_facts            —— 客观事实条目
 *   canon_chapter_summaries—— 章节摘要（结构化）
 *
 * 全部表在 database.ts 用 CREATE TABLE IF NOT EXISTS 创建，老库零迁移成本。
 */
import { getProjectDb } from '../database'
import type {
  TimelineEvent,
  CharacterStateSnapshot,
  PlotLine,
  Fact,
  ChapterSummary,
} from '../../src/services/narrative-consistency/types'

interface TimelineRow {
  id: number
  chapter_number: number
  sequence: number
  characters: string
  location: string
  time_flow: string
  summary: string
  impact: string
  created_at: string
}

interface CharacterStateRow {
  character: string
  location: string
  power_level: string
  physical_state: string
  mental_state: string
  key_items: string
  current_goal: string
  knowledge_json: string
  relationships_json: string
  recent_events: string
  updated_at_chapter: number
  updated_at: string
}

interface PlotLineRow {
  id: number
  name: string
  status: string
  started_at: number
  last_advanced_at: number
  resolved_at: number | null
  characters: string
  current_state: string
  description: string
  created_at: string
}

interface FactRow {
  id: number
  category: string
  statement: string
  introduced_at: number
  characters: string
  evidence: string
  created_at: string
}

interface ChapterSummaryRow {
  chapter_number: number
  title: string
  summary: string
  created_at: string
}

function safeParse<T>(json: string, fallback: T, field: string, entity: string): T {
  if (!json) return fallback
  try { return JSON.parse(json) as T }
  catch (e) {
    const err = e instanceof Error ? e.message : String(e)
    throw new Error(
      `[CanonRepository] 数据已损坏：${entity} 的 ${field} 字段不是合法 JSON ` +
      `(长度=${json.length}, 前 80 字="${json.slice(0, 80)}...")。` +
      `请从备份恢复或重新导入项目。底层错误: ${err}`
    )
  }
}

function rowToTimeline(row: TimelineRow): TimelineEvent {
  return {
    id: row.id,
    chapterNumber: row.chapter_number,
    sequence: row.sequence,
    characters: safeParse<string[]>(row.characters, [], 'characters', `timeline_event#${row.id}`),
    location: row.location,
    timeFlow: row.time_flow === 'flashback' ? 'flashback' : 'sequential',
    summary: row.summary,
    impact: row.impact,
    createdAt: row.created_at,
  }
}

function rowToCharacterState(row: CharacterStateRow): CharacterStateSnapshot {
  return {
    character: row.character,
    location: row.location,
    powerLevel: row.power_level,
    physicalState: row.physical_state,
    mentalState: row.mental_state,
    keyItems: row.key_items,
    currentGoal: row.current_goal,
    knowledge: safeParse<string[]>(row.knowledge_json, [], 'knowledge_json', `character_state#${row.character}`),
    relationships: safeParse<Record<string, string>>(row.relationships_json, {}, 'relationships_json', `character_state#${row.character}`),
    recentEvents: row.recent_events,
    updatedAtChapter: row.updated_at_chapter,
    updatedAt: row.updated_at,
  }
}

function rowToPlotLine(row: PlotLineRow): PlotLine {
  return {
    id: row.id,
    name: row.name,
    status: (row.status as PlotLine['status']) || 'active',
    startedAt: row.started_at,
    lastAdvancedAt: row.last_advanced_at,
    resolvedAt: row.resolved_at ?? undefined,
    characters: safeParse<string[]>(row.characters, [], 'characters', `plot_line#${row.id}`),
    currentState: row.current_state,
    description: row.description,
  }
}

function rowToFact(row: FactRow): Fact {
  return {
    id: row.id,
    category: row.category as Fact['category'],
    statement: row.statement,
    introducedAt: row.introduced_at,
    characters: safeParse<string[]>(row.characters, [], 'characters', `fact#${row.id}`),
    evidence: row.evidence || undefined,
  }
}

function rowToSummary(row: ChapterSummaryRow): ChapterSummary {
  return {
    chapterNumber: row.chapter_number,
    title: row.title,
    summary: row.summary,
    createdAt: row.created_at,
  }
}

export class CanonRepository {
  // ============================================================
  // 时间线事件
  // ============================================================

  /** 获取某章及之前的所有事件（按章号+sequence 升序） */
  static getTimelineUpTo(maxChapter: number, includeFlashback = true): TimelineEvent[] {
    const db = getProjectDb()
    if (!db) return []
    const rows = db.prepare(
      `SELECT * FROM canon_timeline_events
       WHERE chapter_number <= ?
       ${includeFlashback ? '' : "AND time_flow = 'sequential'"}
       ORDER BY chapter_number ASC, sequence ASC`
    ).all(maxChapter) as TimelineRow[]
    return rows.map(rowToTimeline)
  }

  /** 获取某章的所有事件 */
  static getTimelineByChapter(chapterNumber: number): TimelineEvent[] {
    const db = getProjectDb()
    if (!db) return []
    const rows = db.prepare(
      `SELECT * FROM canon_timeline_events
       WHERE chapter_number = ?
       ORDER BY sequence ASC`
    ).all(chapterNumber) as TimelineRow[]
    return rows.map(rowToTimeline)
  }

  /** 追加一个事件；如果 (chapter, sequence) 已存在则覆盖其内容。返回行的 id。 */
  static appendTimelineEvent(event: Omit<TimelineEvent, 'id' | 'createdAt'>): number {
    const db = getProjectDb()
    if (!db) throw new Error('[CanonRepository] 数据库未连接')
    db.prepare(`
      INSERT INTO canon_timeline_events
        (chapter_number, sequence, characters, location, time_flow, summary, impact)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(chapter_number, sequence) DO UPDATE SET
        characters = excluded.characters,
        location = excluded.location,
        time_flow = excluded.time_flow,
        summary = excluded.summary,
        impact = excluded.impact
    `).run(
      event.chapterNumber,
      event.sequence,
      JSON.stringify(event.characters || []),
      event.location || '',
      event.timeFlow || 'sequential',
      event.summary || '',
      event.impact || '',
    )
    const row = db.prepare(
      `SELECT id FROM canon_timeline_events WHERE chapter_number = ? AND sequence = ?`
    ).get(event.chapterNumber, event.sequence) as { id: number }
    return row.id
  }

  /** 删除某章的全部事件（用于重写某章时清理旧事件） */
  static clearChapterTimeline(chapterNumber: number): void {
    const db = getProjectDb()
    if (!db) return
    db.prepare(`DELETE FROM canon_timeline_events WHERE chapter_number = ?`).run(chapterNumber)
  }

  // ============================================================
  // 角色状态
  // ============================================================

  /** 读取所有角色当前状态 */
  static getAllCharacterStates(): CharacterStateSnapshot[] {
    const db = getProjectDb()
    if (!db) return []
    const rows = db.prepare(
      `SELECT * FROM canon_character_state ORDER BY updated_at_chapter DESC, character ASC`
    ).all() as CharacterStateRow[]
    return rows.map(rowToCharacterState)
  }

  /** 读取单个角色当前状态 */
  static getCharacterState(character: string): CharacterStateSnapshot | null {
    const db = getProjectDb()
    if (!db) return null
    const row = db.prepare(
      `SELECT * FROM canon_character_state WHERE character = ?`
    ).get(character) as CharacterStateRow | undefined
    return row ? rowToCharacterState(row) : null
  }

  /**
   * Upsert 角色状态（merge 语义）。
   * 标量字段：snapshot 非空时覆盖。
   * knowledge 列表：累加 + dedup（Set union）。
   * relationships：浅合并（snapshot 中的同名 key 覆盖旧的）。
   */
  static upsertCharacterState(snapshot: CharacterStateSnapshot): void {
    const db = getProjectDb()
    if (!db) throw new Error('[CanonRepository] 数据库未连接')

    const existing = this.getCharacterState(snapshot.character)
    const merged: CharacterStateSnapshot = existing
      ? {
          ...existing,
          // 标量字段：用 snapshot 覆盖（如果非空），否则保留旧值
          location: snapshot.location || existing.location,
          powerLevel: snapshot.powerLevel || existing.powerLevel,
          physicalState: snapshot.physicalState || existing.physicalState,
          mentalState: snapshot.mentalState || existing.mentalState,
          keyItems: snapshot.keyItems || existing.keyItems,
          currentGoal: snapshot.currentGoal || existing.currentGoal,
          recentEvents: snapshot.recentEvents || existing.recentEvents,
          // 列表字段：union + dedup
          knowledge: Array.from(new Set([
            ...(existing.knowledge || []),
            ...(snapshot.knowledge || []),
          ])),
          relationships: {
            ...(existing.relationships || {}),
            ...(snapshot.relationships || {}),
          },
          updatedAtChapter: snapshot.updatedAtChapter || existing.updatedAtChapter,
          updatedAt: snapshot.updatedAt || new Date().toISOString(),
        }
      : {
          ...snapshot,
          updatedAt: snapshot.updatedAt || new Date().toISOString(),
        }

    db.prepare(`
      INSERT INTO canon_character_state
        (character, location, power_level, physical_state, mental_state, key_items,
         current_goal, knowledge_json, relationships_json, recent_events,
         updated_at_chapter, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(character) DO UPDATE SET
        location = excluded.location,
        power_level = excluded.power_level,
        physical_state = excluded.physical_state,
        mental_state = excluded.mental_state,
        key_items = excluded.key_items,
        current_goal = excluded.current_goal,
        knowledge_json = excluded.knowledge_json,
        relationships_json = excluded.relationships_json,
        recent_events = excluded.recent_events,
        updated_at_chapter = excluded.updated_at_chapter,
        updated_at = excluded.updated_at
    `).run(
      merged.character,
      merged.location || '',
      merged.powerLevel || '',
      merged.physicalState || '',
      merged.mentalState || '',
      merged.keyItems || '',
      merged.currentGoal || '',
      JSON.stringify(merged.knowledge || []),
      JSON.stringify(merged.relationships || {}),
      merged.recentEvents || '',
      merged.updatedAtChapter || 0,
      merged.updatedAt,
    )
  }

  // ============================================================
  // 剧情线
  // ============================================================

  static getPlotLines(filter?: { status?: PlotLine['status'] }): PlotLine[] {
    const db = getProjectDb()
    if (!db) return []
    let sql = `SELECT * FROM canon_plot_lines`
    const args: unknown[] = []
    if (filter?.status) {
      sql += ` WHERE status = ?`
      args.push(filter.status)
    }
    sql += ` ORDER BY last_advanced_at DESC, id ASC`
    const rows = db.prepare(sql).all(...args) as PlotLineRow[]
    return rows.map(rowToPlotLine)
  }

  /** 按名字查找（用于去重） */
  static findPlotLineByName(name: string): PlotLine | null {
    const db = getProjectDb()
    if (!db) return null
    const row = db.prepare(
      `SELECT * FROM canon_plot_lines WHERE name = ? COLLATE NOCASE LIMIT 1`
    ).get(name) as PlotLineRow | undefined
    return row ? rowToPlotLine(row) : null
  }

  /** 规范化字符串用于去重：trim + 折叠空白 + NFKC */
  private static normalizeForDedup(s: string): string {
    return (s || '').trim().replace(/\s+/g, ' ').normalize('NFKC')
  }

  static addPlotLine(line: Omit<PlotLine, 'id'>): number {
    const db = getProjectDb()
    if (!db) throw new Error('[CanonRepository] 数据库未连接')
    const normalizedName = this.normalizeForDedup(line.name)
    if (!normalizedName) throw new Error('[CanonRepository] addPlotLine: name 不能为空')
    const existing = this.findPlotLineByName(normalizedName)
    if (existing) return existing.id || 0
    const r = db.prepare(`
      INSERT INTO canon_plot_lines
        (name, status, started_at, last_advanced_at, resolved_at, characters, current_state, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      normalizedName,
      line.status || 'active',
      line.startedAt || 0,
      line.lastAdvancedAt || line.startedAt || 0,
      line.resolvedAt ?? null,
      JSON.stringify(line.characters || []),
      line.currentState || '',
      line.description || '',
    )
    return Number(r.lastInsertRowid)
  }

  static advancePlotLine(id: number, currentState: string, lastAdvancedAt: number): void {
    const db = getProjectDb()
    if (!db) return
    db.prepare(`
      UPDATE canon_plot_lines
      SET current_state = ?, last_advanced_at = ?
      WHERE id = ?
    `).run(currentState, lastAdvancedAt, id)
  }

  static resolvePlotLine(id: number, chapterNumber: number): void {
    const db = getProjectDb()
    if (!db) return
    db.prepare(`
      UPDATE canon_plot_lines
      SET status = 'resolved', resolved_at = ?, last_advanced_at = ?
      WHERE id = ?
    `).run(chapterNumber, chapterNumber, id)
  }

  // ============================================================
  // 事实
  // ============================================================

  static getFacts(): Fact[] {
    const db = getProjectDb()
    if (!db) return []
    const rows = db.prepare(
      `SELECT * FROM canon_facts ORDER BY introduced_at ASC, id ASC`
    ).all() as FactRow[]
    return rows.map(rowToFact)
  }

  static addFact(fact: Omit<Fact, 'id'>): number {
    const db = getProjectDb()
    if (!db) throw new Error('[CanonRepository] 数据库未连接')
    const normalizedStatement = this.normalizeForDedup(fact.statement)
    if (!normalizedStatement) throw new Error('[CanonRepository] addFact: statement 不能为空')
    // 用 UNIQUE 索引 + INSERT OR IGNORE 处理重复（依赖 migration 添加的 idx_canon_facts_unique）
    const r = db.prepare(`
      INSERT OR IGNORE INTO canon_facts (category, statement, introduced_at, characters, evidence)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      fact.category,
      normalizedStatement,
      fact.introducedAt || 0,
      JSON.stringify(fact.characters || []),
      (fact.evidence || '').slice(0, 500),  // 截断 evidence
    )
    if (r.changes > 0) return Number(r.lastInsertRowid)
    // 重复：返回已存在行的 id
    const row = db.prepare(
      `SELECT id FROM canon_facts WHERE statement = ? COLLATE NOCASE`
    ).get(normalizedStatement) as { id: number } | undefined
    if (!row) throw new Error('[CanonRepository] addFact: INSERT OR IGNORE 失败')
    return row.id
  }

  /** 删除某章引入的全部事实（用于重写） */
  static clearChapterFacts(chapterNumber: number): void {
    const db = getProjectDb()
    if (!db) return
    db.prepare(`DELETE FROM canon_facts WHERE introduced_at = ?`).run(chapterNumber)
  }

  // ============================================================
  // 章节摘要
  // ============================================================

  static getRecentSummaries(limit = 5): ChapterSummary[] {
    const db = getProjectDb()
    if (!db) return []
    const rows = db.prepare(
      `SELECT * FROM canon_chapter_summaries
       ORDER BY chapter_number DESC LIMIT ?`
    ).all(limit) as ChapterSummaryRow[]
    return rows.map(rowToSummary).reverse()
  }

  static getSummary(chapterNumber: number): ChapterSummary | null {
    const db = getProjectDb()
    if (!db) return null
    const row = db.prepare(
      `SELECT * FROM canon_chapter_summaries WHERE chapter_number = ?`
    ).get(chapterNumber) as ChapterSummaryRow | undefined
    return row ? rowToSummary(row) : null
  }

  static upsertSummary(summary: ChapterSummary): void {
    const db = getProjectDb()
    if (!db) throw new Error('[CanonRepository] 数据库未连接')
    db.prepare(`
      INSERT INTO canon_chapter_summaries (chapter_number, title, summary, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(chapter_number) DO UPDATE SET
        title = excluded.title,
        summary = excluded.summary,
        created_at = excluded.created_at
    `).run(
      summary.chapterNumber,
      summary.title || '',
      summary.summary || '',
      summary.createdAt || new Date().toISOString(),
    )
  }

  // ============================================================
  // 原子写回（章节定稿主路径）
  // ============================================================

  /**
   * 整段章节定稿的写回打包成单次 SQLite 事务。
   * 步骤：(1) 清本章 timeline (2) 清本章 facts (3) 追加 timeline 事件
   *      (4) 合并/写入角色状态 (5) 追加剧情线 (6) 追加事实
   * 任何步骤失败 → 整个事务回滚。
   *
   * 这是 `canon-store.writeback` 调用的主路径。
   */
  static writebackAtomically(payload: {
    chapterNumber: number
    newEvents: Omit<TimelineEvent, 'id' | 'createdAt'>[]
    characterDeltas: Array<{ character: string; after: Partial<CharacterStateSnapshot>; chapterNumber: number }>
    plotLineChanges?: {
      added?: Omit<PlotLine, 'id'>[]
      advanced?: Array<{ id: number; currentState: string; lastAdvancedAt: number }>
      resolved?: number[]
    }
    newFacts: Omit<Fact, 'id'>[]
  }): {
    timelineIds: number[]
    characterStatesWritten: number
    plotIds: number[]
    factIds: number[]
  } {
    const db = getProjectDb()
    if (!db) throw new Error('[CanonRepository] 数据库未连接')

    const tx = db.transaction(() => {
      // 1) 清本章 timeline
      db.prepare(`DELETE FROM canon_timeline_events WHERE chapter_number = ?`)
        .run(payload.chapterNumber)
      // 2) 清本章 facts
      db.prepare(`DELETE FROM canon_facts WHERE introduced_at = ?`)
        .run(payload.chapterNumber)

      const timelineIds: number[] = []
      for (const ev of payload.newEvents || []) {
        db.prepare(`
          INSERT INTO canon_timeline_events
            (chapter_number, sequence, characters, location, time_flow, summary, impact)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(chapter_number, sequence) DO UPDATE SET
            characters = excluded.characters,
            location = excluded.location,
            time_flow = excluded.time_flow,
            summary = excluded.summary,
            impact = excluded.impact
        `).run(
          ev.chapterNumber, ev.sequence,
          JSON.stringify(ev.characters || []), ev.location || '',
          ev.timeFlow || 'sequential', ev.summary || '', ev.impact || '',
        )
        const idRow = db.prepare(
          `SELECT id FROM canon_timeline_events WHERE chapter_number = ? AND sequence = ?`
        ).get(ev.chapterNumber, ev.sequence) as { id: number }
        timelineIds.push(idRow.id)
      }

      let characterStatesWritten = 0
      for (const delta of payload.characterDeltas || []) {
        // merge by upsertCharacterState (which now does knowledge union)
        this.upsertCharacterState({
          character: delta.character,
          location: delta.after.location || '',
          powerLevel: delta.after.powerLevel || '',
          physicalState: delta.after.physicalState || '',
          mentalState: delta.after.mentalState || '',
          keyItems: delta.after.keyItems || '',
          currentGoal: delta.after.currentGoal || '',
          knowledge: delta.after.knowledge || [],
          relationships: delta.after.relationships || {},
          recentEvents: delta.after.recentEvents || '',
          updatedAtChapter: delta.chapterNumber,
          updatedAt: new Date().toISOString(),
        })
        characterStatesWritten++
      }

      const plotIds: number[] = []
      for (const line of payload.plotLineChanges?.added || []) {
        const id = this.addPlotLine(line)
        plotIds.push(id)
      }
      for (const adv of payload.plotLineChanges?.advanced || []) {
        this.advancePlotLine(adv.id, adv.currentState, adv.lastAdvancedAt)
      }
      for (const id of payload.plotLineChanges?.resolved || []) {
        this.resolvePlotLine(id, payload.chapterNumber)
      }

      const factIds: number[] = []
      for (const fact of payload.newFacts || []) {
        const id = this.addFact(fact)
        factIds.push(id)
      }

      return { timelineIds, characterStatesWritten, plotIds, factIds }
    })

    return tx()
  }
}
