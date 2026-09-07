import { createHash, randomUUID } from 'node:crypto'
import { requireProjectDatabase } from './rehearsal-repository'
import type { StoryDocument, StoryDocumentRef, StoryReadRequest, StoryReadResult, StoryRevision, StoryRevisionRequest, StoryIndex, StoryIndexEntry } from '../../src/shared/story-revision'

// Draft text needs an explicit author instruction. Finalized/archived versions remain
// protected because their canon and downstream publication state require a separate rewrite.
const fields = {
  core: { genre: 'genre', subGenre: 'sub_genre', writingStyle: 'writing_style', narrativePov: 'narrative_pov', globalGuidance: 'global_guidance', goldenFinger: 'golden_finger', premise: 'premise', worldbuilding: 'worldbuilding', charactersArch: 'characters_arch', synopsis: 'synopsis' },
  blueprint: { title: 'title', role: 'role', purpose: 'purpose', keyEvents: 'key_events', characters: 'characters', suspenseHook: 'suspense_hook', userGuidance: 'user_guidance' },
  character: { role: 'role', appearance: 'appearance', personality: 'personality', background: 'background', abilities: 'abilities', motivation: 'motivation', relationships: 'relationships', arc: 'arc', notes: 'notes' },
  draft: { content: 'body' },
} as const
const table = { core: 'project_core', blueprint: 'blueprints', character: 'characters', draft: 'drafts' } as const
const key = { core: 'id', blueprint: 'chapter_number', character: 'name', draft: 'id' } as const

function validateRef(ref: StoryDocumentRef) {
  if (!ref || !Object.hasOwn(table, ref.kind) || typeof ref.id !== 'string' || !ref.id || ref.id.length > 200) throw new Error('无效的内容位置。请重新读取作品目录。')
  if (ref.kind === 'core' && ref.id !== 'main') throw new Error('项目内容标识应为 main。')
  if (['blueprint', 'draft'].includes(ref.kind) && (!/^[1-9]\d*$/.test(ref.id) || !Number.isSafeInteger(Number(ref.id)))) throw new Error('无效的章节或草稿编号。')
}

function ensureJournal(projectPath: string) {
  const db = requireProjectDatabase(projectPath)
  db.exec(`CREATE TABLE IF NOT EXISTS story_revisions (
    id TEXT PRIMARY KEY, intent TEXT NOT NULL, summary TEXT NOT NULL,
    created_at TEXT NOT NULL, status TEXT NOT NULL, changes_json TEXT NOT NULL
  )`)
  return db
}

function document(projectPath: string, ref: StoryDocumentRef): StoryDocument {
  validateRef(ref)
  const db = requireProjectDatabase(projectPath)
  const row = (ref.kind === 'draft'
    ? db.prepare('SELECT d.*, c.body FROM drafts d JOIN contents c ON c.id = d.content_id WHERE d.id = ?').get(ref.id)
    : db.prepare(`SELECT * FROM ${table[ref.kind]} WHERE ${key[ref.kind]} = ?`).get(ref.id)) as Record<string, unknown> | undefined
  if (!row) throw new Error('内容不存在，请刷新作品目录。')
  const data: Record<string, string> = {}
  for (const [name, column] of Object.entries(fields[ref.kind])) data[name] = String(row[column] ?? '')
  const version = createHash('sha256').update(JSON.stringify(row)).digest('hex')
  return {
    ...ref, version, fields: data,
    title: ref.kind === 'core' ? '全书设定与架构' : ref.kind === 'character' ? ref.id : ref.kind === 'draft' ? `第 ${row.chapter_number} 章 · 草稿 v${row.version}` : `第 ${ref.id} 章 · ${row.title}`,
    ...(row.chapter_number ? { chapterNumber: Number(row.chapter_number) } : {}),
    ...(row.status ? { status: String(row.status) } : {}),
  }
}

export function readStoryDocument(projectPath: string, request: StoryReadRequest): StoryReadResult {
  const doc = document(projectPath, request)
  const { fields: data, ...meta } = doc
  const result: StoryReadResult = { ...meta, fieldLengths: Object.fromEntries(Object.entries(data).map(([name, text]) => [name, text.length])) }
  if (request.field !== undefined) {
    if (!Object.hasOwn(data, request.field)) throw new Error('该内容没有此字段，请使用 fieldLengths 中的字段名。')
    const offset = request.offset ?? 0
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > data[request.field].length) throw new Error('无效的读取位置。')
    const content = data[request.field]
    result.field = request.field
    result.content = content.slice(offset, offset + 3500)
    result.nextOffset = offset + 3500 < content.length ? offset + 3500 : null
  }
  return result
}

export function indexStory(projectPath: string, query = '', offset = 0): StoryIndex {
  const db = requireProjectDatabase(projectPath)
  if (typeof query !== 'string' || query.length > 200 || !Number.isSafeInteger(offset) || offset < 0) throw new Error('无效的搜索条件。')
  const refs: StoryDocumentRef[] = [
    { kind: 'core', id: 'main' },
    ...(db.prepare('SELECT name FROM characters ORDER BY name').all() as { name: string }[]).map(r => ({ kind: 'character' as const, id: r.name })),
    ...(db.prepare('SELECT chapter_number n FROM blueprints ORDER BY chapter_number').all() as { n: number }[]).map(r => ({ kind: 'blueprint' as const, id: String(r.n) })),
    ...(db.prepare('SELECT id FROM drafts WHERE id IN (SELECT MAX(id) FROM drafts GROUP BY chapter_number) OR status = ? ORDER BY chapter_number, version').all('finalized') as { id: number }[]).map(r => ({ kind: 'draft' as const, id: String(r.id) })),
  ]
  const matches: StoryIndexEntry[] = []
  for (const ref of refs) {
    const doc = document(projectPath, ref)
    const text = Object.values(doc.fields).join('\n')
    const found = text.toLowerCase().indexOf(query.toLowerCase())
    if (query && found < 0 && !doc.title.toLowerCase().includes(query.toLowerCase())) continue
    matches.push({ ...ref, title: doc.title, chapterNumber: doc.chapterNumber, status: doc.status, excerpt: text.slice(Math.max(0, found - 50), Math.max(0, found - 50) + 160) })
  }
  return { entries: matches.slice(offset, offset + 15), total: matches.length, nextOffset: offset + 15 < matches.length ? offset + 15 : null }
}

function writableDraft(projectPath: string, id: string) {
  const db = requireProjectDatabase(projectPath)
  const row = db.prepare('SELECT * FROM drafts WHERE id = ?').get(id) as { chapter_number: number; status: string; word_count: number } | undefined
  if (!row) throw new Error('草稿不存在。')
  if (['finalized', 'archived'].includes(row.status)) throw new Error('已定稿或归档正文不能直接覆盖；本次未修改，请明确告知作者尚未处理的章节。')
  const latest = db.prepare('SELECT id FROM drafts WHERE chapter_number = ? ORDER BY version DESC, id DESC LIMIT 1').get(row.chapter_number) as { id: number }
  if (String(latest.id) !== id) throw new Error('该章已有较新草稿，请重新读取最新版本。')
  return row
}

function writeField(projectPath: string, change: StoryRevision['changes'][number], value: string, undo = false) {
  const map: Record<string, string> = fields[change.kind]
  if (!Object.hasOwn(map, change.field)) throw new Error('该字段不可修改。')
  const db = requireProjectDatabase(projectPath)
  if (change.kind === 'draft') {
    writableDraft(projectPath, change.id)
    if (!change.draftState) throw new Error('正文修改缺少原始状态，未保存。')
    // Copy on write: preserve text referenced by earlier revisions/reviews.
    const content = db.prepare('INSERT INTO contents (body) VALUES (?)').run(value)
    db.prepare("UPDATE drafts SET content_id = ?, word_count = ?, status = ?, updated_at = datetime('now') WHERE id = ?")
      .run(content.lastInsertRowid, undo ? change.draftState.beforeWordCount : value.length, undo ? change.draftState.beforeStatus : change.draftState.afterStatus, change.id)
    return
  }
  const result = db.prepare(`UPDATE ${table[change.kind]} SET ${map[change.field]} = ?, updated_at = datetime('now') WHERE ${key[change.kind]} = ?`).run(value, change.id)
  if (result.changes !== 1) throw new Error('内容已被移除，调整未保存。')
}

export function applyStoryRevision(projectPath: string, request: StoryRevisionRequest): StoryRevision {
  const db = ensureJournal(projectPath)
  if (!request || typeof request.intent !== 'string' || !request.intent.trim() || request.intent.length > 4000 ||
      typeof request.summary !== 'string' || !request.summary.trim() || request.summary.length > 8000 ||
      !Array.isArray(request.edits) || request.edits.length < 1 || request.edits.length > 60) throw new Error('请提供创作意图、影响说明以及 1–60 项具体修改。')
  return db.transaction(() => {
    const docs = new Map<string, StoryDocument>()
    const revision: StoryRevision = { id: randomUUID(), intent: request.intent, summary: request.summary, createdAt: new Date().toISOString(), status: 'applied', changes: [] }
    for (const edit of request.edits) {
      validateRef(edit)
      if (edit.kind === 'draft') {
        if (request.editWrittenText !== true) throw new Error('本轮默认保留已写正文；作者明确要求改正文后，才可设置 editWrittenText=true。')
        writableDraft(projectPath, edit.id)
      }
      if (typeof edit.field !== 'string' || typeof edit.oldText !== 'string' || typeof edit.newText !== 'string' || edit.newText.length > 50000) throw new Error('修改字段与文本格式不正确。')
      const identity = `${edit.kind}:${edit.id}`
      let doc = docs.get(identity)
      if (!doc) { doc = document(projectPath, edit); docs.set(identity, doc) }
      if (doc.version !== edit.version) throw new Error(`${doc.title} 已有更新，请重新读取后调整；本次未写入任何修改。`)
      if (!Object.hasOwn(doc.fields, edit.field)) throw new Error('该字段不可修改。')
      const previous = revision.changes.find(c => c.kind === edit.kind && c.id === edit.id && c.field === edit.field)
      const before = previous?.after ?? doc.fields[edit.field]
      if (!edit.oldText && before) throw new Error('空 oldText 只能用于填入空字段，不能覆盖已有内容。')
      const at = before.indexOf(edit.oldText)
      if (at < 0 || (edit.oldText && before.indexOf(edit.oldText, at + 1) >= 0)) throw new Error(`${doc.title} 的替换位置不唯一或不存在，请读取更多上下文。`)
      const after = before.slice(0, at) + edit.newText + before.slice(at + edit.oldText.length)
      if (edit.kind === 'draft' && !after.trim()) throw new Error('改写结果为空，未覆盖正文。')
      if (edit.kind === 'core' && edit.field === 'narrativePov' && !['first_person', 'third_limited', 'third_omniscient', 'multi_pov'].includes(after)) throw new Error('叙述视角值不正确。')
      if (edit.kind === 'blueprint' && edit.field === 'characters') {
        let names: unknown
        try { names = JSON.parse(after) } catch { throw new Error('蓝图出场人物必须是 JSON 字符串数组。') }
        if (!Array.isArray(names) || names.length > 60 || names.some(name => typeof name !== 'string' || !name.trim() || name.length > 200)) throw new Error('蓝图出场人物必须是有效的姓名数组。')
      }
      if (after === before) continue
      if (previous) previous.after = after
      else {
        const draft = edit.kind === 'draft' ? writableDraft(projectPath, edit.id) : undefined
        revision.changes.push({ kind: edit.kind, id: edit.id, title: doc.title, field: edit.field, before, after,
          ...(draft ? { draftState: { beforeStatus: draft.status, beforeWordCount: draft.word_count, afterStatus: 'draft' } } : {}),
        })
      }
    }
    if (!revision.changes.length) throw new Error('没有实际内容变化，未创建修改记录。')
    for (const change of revision.changes) writeField(projectPath, change, change.after)
    // Read back inside the transaction before reporting success.
    for (const change of revision.changes) if (document(projectPath, change).fields[change.field] !== change.after) throw new Error('保存核对失败。')
    db.prepare('INSERT INTO story_revisions VALUES (?, ?, ?, ?, ?, ?)').run(revision.id, revision.intent, revision.summary, revision.createdAt, revision.status, JSON.stringify(revision.changes))
    return revision
  })()
}

export function listStoryRevisions(projectPath: string): StoryRevision[] {
  const db = ensureJournal(projectPath)
  return (db.prepare('SELECT * FROM story_revisions ORDER BY created_at DESC, rowid DESC LIMIT 100').all() as Record<string, string>[]).map(row => ({ id: row.id, intent: row.intent, summary: row.summary, createdAt: row.created_at, status: row.status as StoryRevision['status'], changes: JSON.parse(row.changes_json) }))
}

export function undoStoryRevision(projectPath: string, id: string): StoryRevision {
  const db = ensureJournal(projectPath)
  return db.transaction(() => {
    const revision = listStoryRevisions(projectPath).find(r => r.id === id)
    if (!revision || revision.status !== 'applied') throw new Error('该调整不存在或已经撤回。')
    for (const change of revision.changes) {
      if (document(projectPath, change).fields[change.field] !== change.after) throw new Error(`${change.title} 后来又被修改，不能直接撤回覆盖；请让助手基于当前版本调整。`)
      if (change.kind === 'draft' && writableDraft(projectPath, change.id).status !== change.draftState?.afterStatus) throw new Error('正文后来已经审稿或改变状态，不能直接撤回覆盖。')
    }
    for (const change of revision.changes) writeField(projectPath, change, change.before, true)
    db.prepare("UPDATE story_revisions SET status = 'undone' WHERE id = ?").run(id)
    return { ...revision, status: 'undone' as const }
  })()
}
