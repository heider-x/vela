import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { initProjectDatabase, closeProjectDatabase, getProjectDb } from '../database'
import { ProjectCoreRepository } from '../repositories/project-core-repository'
import { CharacterRepository } from '../repositories/character-repository'
import { BlueprintRepository } from '../repositories/blueprint-repository'
import { DraftRepository } from '../repositories/draft-repository'
import { applyStoryRevision, readStoryDocument, indexStory, listStoryRevisions, undoStoryRevision } from '../repositories/story-revision-repository'
import type { StoryTextEdit } from '../../src/shared/story-revision'

let folder: string
let draftId: number
beforeEach(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-story-revision-'))
  initProjectDatabase(folder)
  ProjectCoreRepository.init('剧情调整测试')
  ProjectCoreRepository.update({ synopsis: '反派在第八章败退。', globalGuidance: '维持动机可信。' })
  CharacterRepository.upsert({ name: '顾野', role: 'antagonist', gender: '', age: '', appearance: '', personality: '谨慎', background: '', abilities: '', motivation: '保护家族', relationships: '', arc: '第八章败退', notes: '' })
  BlueprintRepository.upsert({ chapterNumber: 3, title: '对峙', role: '转折', purpose: '取得证据', keyEvents: '顾野继续控制码头。', characters: ['顾野'], suspenseHook: '密信出现', userGuidance: '', notes: '已经写成的摘要', notesUpdatedAt: '' })
  draftId = DraftRepository.create({ chapterNumber: 1, version: 1, source: 'write', content: '顾野在第一章登场。', wordCount: 10 })
  DraftRepository.updateStatus(draftId, 'finalized')
})
afterEach(() => {
  closeProjectDatabase()
  const resolved = path.resolve(folder)
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('vela-story-revision-')) throw new Error('Unsafe cleanup path')
  fs.rmSync(resolved, { recursive: true })
})
function edit(kind: StoryTextEdit['kind'], id: string, field: string, oldText: string, newText: string): StoryTextEdit {
  return { kind, id, field, oldText, newText, version: readStoryDocument(folder, { kind, id }).version }
}
const request = (edits: StoryTextEdit[]) => ({ intent: '让顾野第三章败走，保留前文', summary: '将势力交给幕后商会，保留密信伏笔。', edits })

describe('atomic author-directed story revisions', () => {
  it('validates narrative perspective and refuses an empty prose rewrite', () => {
    ProjectCoreRepository.update({ narrativePov: 'first_person' })
    const revision = applyStoryRevision(folder, request([edit('core', 'main', 'narrativePov', 'first_person', 'third_limited')]))
    expect(ProjectCoreRepository.get()?.narrativePov).toBe('third_limited')
    expect(() => applyStoryRevision(folder, request([edit('core', 'main', 'narrativePov', 'third_limited', 'invalid')]))).toThrow('叙述视角')
    undoStoryRevision(folder, revision.id)
    expect(ProjectCoreRepository.get()?.narrativePov).toBe('first_person')
    DraftRepository.updateStatus(draftId, 'draft')
    expect(() => applyStoryRevision(folder, { ...request([edit('draft', String(draftId), 'content', '顾野在第一章登场。', '')]), editWrittenText: true })).toThrow('结果为空')
    expect(DraftRepository.getFull(draftId)?.content).toBe('顾野在第一章登场。')
  })
  it('updates blueprint participants as a validated list and rejects malformed lists', () => {
    applyStoryRevision(folder, request([edit('blueprint', '3', 'characters', '["顾野"]', '["主角","商会使者"]')]))
    expect(BlueprintRepository.getByChapter(3)?.characters).toEqual(['主角', '商会使者'])
    expect(() => applyStoryRevision(folder, request([edit('blueprint', '3', 'characters', '["主角","商会使者"]', '[42]')]))).toThrow('姓名数组')
  })
  it('persists linked changes, reopens, and undoes them while retaining finalized prose', () => {
    const revision = applyStoryRevision(folder, request([
      edit('core', 'main', 'synopsis', '第八章', '第三章'),
      edit('character', '顾野', 'arc', '第八章', '第三章'),
      edit('blueprint', '3', 'keyEvents', '顾野继续控制码头。', '顾野败退，商会接管码头。'),
    ]))
    expect(revision.changes).toHaveLength(3)
    closeProjectDatabase(); initProjectDatabase(folder)
    expect(listStoryRevisions(folder)[0].id).toBe(revision.id)
    expect(ProjectCoreRepository.get()?.synopsis).toBe('反派在第三章败退。')
    expect(DraftRepository.getFull(draftId)?.content).toBe('顾野在第一章登场。')
    undoStoryRevision(folder, revision.id)
    expect(ProjectCoreRepository.get()?.synopsis).toBe('反派在第八章败退。')
    expect(BluePrintEvents()).toBe('顾野继续控制码头。')
    expect(listStoryRevisions(folder)[0].status).toBe('undone')
  })
  it('rejects the whole change if any observed resource was concurrently modified', () => {
    const changes = [edit('core', 'main', 'synopsis', '第八章', '第三章'), edit('blueprint', '3', 'keyEvents', '控制', '放弃')]
    BlueprintRepository.updateNotes(3, '新写入的摘要')
    expect(() => applyStoryRevision(folder, request(changes))).toThrow('已有更新')
    expect(ProjectCoreRepository.get()?.synopsis).toBe('反派在第八章败退。')
    expect(listStoryRevisions(folder)).toHaveLength(0)
  })
  it('refuses ambiguous replacement and rolls back database errors', () => {
    ProjectCoreRepository.update({ synopsis: '顾野，顾野。' })
    expect(() => applyStoryRevision(folder, request([edit('core', 'main', 'synopsis', '顾野', '商会')]))).toThrow('不唯一')
    getProjectDb()!.exec("CREATE TRIGGER fail_story BEFORE UPDATE ON blueprints BEGIN SELECT RAISE(ABORT, 'test failure'); END")
    expect(() => applyStoryRevision(folder, request([edit('core', 'main', 'synopsis', '顾野，顾野。', '商会'), edit('blueprint', '3', 'keyEvents', '控制', '放弃')]))).toThrow('test failure')
    expect(ProjectCoreRepository.get()?.synopsis).toBe('顾野，顾野。')
    expect(listStoryRevisions(folder)).toHaveLength(0)
  })
  it('blocks stale undo atomically but permits unrelated later edits', () => {
    const revision = applyStoryRevision(folder, request([edit('core', 'main', 'synopsis', '第八章', '第三章'), edit('blueprint', '3', 'keyEvents', '控制', '放弃')]))
    ProjectCoreRepository.update({ writingStyle: '冷峻' })
    getProjectDb()!.prepare('UPDATE blueprints SET key_events = ? WHERE chapter_number = 3').run('作者的新安排')
    expect(() => undoStoryRevision(folder, revision.id)).toThrow('后来又被修改')
    expect(ProjectCoreRepository.get()?.synopsis).toBe('反派在第三章败退。')
    getProjectDb()!.prepare('UPDATE blueprints SET key_events = ? WHERE chapter_number = 3').run('顾野继续放弃码头。')
    undoStoryRevision(folder, revision.id)
    expect(ProjectCoreRepository.get()?.writingStyle).toBe('冷峻')
  })
  it('rejects cross-project actions and requires explicit prose intent without allowing identifier changes', () => {
    expect(() => indexStory(path.join(folder, 'other'))).toThrow('PROJECT_CHANGED')
    expect(() => applyStoryRevision(folder, request([edit('draft', String(draftId), 'content', '顾野', '商会')]))).toThrow('保留已写正文')
    expect(() => applyStoryRevision(folder, request([edit('blueprint', '3', 'chapterNumber', '3', '4')]))).toThrow('不可修改')
  })
  it('saves explicit prose edits atomically with style, preserves old text and restores both on undo', () => {
    DraftRepository.updateStatus(draftId, 'reviewed')
    const original = DraftRepository.getFull(draftId)!
    const revision = applyStoryRevision(folder, { ...request([
      edit('core', 'main', 'writingStyle', '', '第三人称限制视角'),
      edit('draft', String(draftId), 'content', '顾野在第一章登场。', '顾野走进码头。他看见一封密信。'),
    ]), editWrittenText: true })
    const saved = DraftRepository.getFull(draftId)!
    expect(saved.content).toBe('顾野走进码头。他看见一封密信。')
    expect(saved.wordCount).toBe(saved.content.length)
    expect(saved.status).toBe('draft')
    expect(saved.contentId).not.toBe(original.contentId)
    expect(getProjectDb()!.prepare('SELECT body FROM contents WHERE id = ?').get(original.contentId)).toEqual({ body: original.content })
    closeProjectDatabase(); initProjectDatabase(folder)
    undoStoryRevision(folder, revision.id)
    expect(DraftRepository.getFull(draftId)).toMatchObject({ content: original.content, wordCount: original.wordCount, status: 'reviewed' })
    expect(ProjectCoreRepository.get()?.writingStyle).toBe('')
  })
  it('rejects finalized/archived or superseded drafts, including when mixed with configuration edits', () => {
    const apply = () => applyStoryRevision(folder, { ...request([edit('core', 'main', 'writingStyle', '', '第三人称'), edit('draft', String(draftId), 'content', '顾野', '商会')]), editWrittenText: true })
    expect(apply).toThrow('已定稿或归档')
    DraftRepository.updateStatus(draftId, 'archived')
    expect(apply).toThrow('已定稿或归档')
    DraftRepository.updateStatus(draftId, 'draft')
    DraftRepository.create({ chapterNumber: 1, version: 2, source: 'rewrite', content: '新版本', wordCount: 3 })
    expect(apply).toThrow('较新草稿')
    expect(ProjectCoreRepository.get()?.writingStyle).toBe('')
  })
  it('does not overwrite a concurrent prose edit and rolls back content-pool writes after a database failure', () => {
    DraftRepository.updateStatus(draftId, 'draft')
    const change = edit('draft', String(draftId), 'content', '顾野', '他')
    DraftRepository.updateContent(draftId, '作者刚写的新句。', 8)
    expect(() => applyStoryRevision(folder, { ...request([change]), editWrittenText: true })).toThrow('已有更新')
    const count = getProjectDb()!.prepare('SELECT COUNT(*) n FROM contents').get()
    getProjectDb()!.exec("CREATE TRIGGER fail_prose BEFORE UPDATE ON drafts BEGIN SELECT RAISE(ABORT, 'draft failure'); END")
    expect(() => applyStoryRevision(folder, { ...request([edit('core', 'main', 'writingStyle', '', '第三人称'), edit('draft', String(draftId), 'content', '作者刚写的新句。', '他刚走进码头。')]), editWrittenText: true })).toThrow('draft failure')
    expect(getProjectDb()!.prepare('SELECT COUNT(*) n FROM contents').get()).toEqual(count)
    expect(ProjectCoreRepository.get()?.writingStyle).toBe('')
    expect(listStoryRevisions(folder)).toHaveLength(0)
  })
  it('blocks prose undo after further edits or a lifecycle change without reverting other fields', () => {
    DraftRepository.updateStatus(draftId, 'draft')
    const revision = applyStoryRevision(folder, { ...request([edit('core', 'main', 'writingStyle', '', '第三人称'), edit('draft', String(draftId), 'content', '顾野', '他')]), editWrittenText: true })
    DraftRepository.updateStatus(draftId, 'reviewed')
    expect(() => undoStoryRevision(folder, revision.id)).toThrow('已经审稿')
    DraftRepository.updateStatus(draftId, 'draft')
    DraftRepository.updateContent(draftId, '他后来走上河堤。', 9)
    expect(() => undoStoryRevision(folder, revision.id)).toThrow('后来又被修改')
    expect(ProjectCoreRepository.get()?.writingStyle).toBe('第三人称')
  })
  it('exposes complete paginated text and marks written evidence separately from plans', () => {
    ProjectCoreRepository.update({ synopsis: '前'.repeat(3500) + '末尾伏笔' })
    const first = readStoryDocument(folder, { kind: 'core', id: 'main', field: 'synopsis' })
    const rest = readStoryDocument(folder, { kind: 'core', id: 'main', field: 'synopsis', offset: first.nextOffset! })
    expect(rest.content).toBe('末尾伏笔')
    expect(rest.nextOffset).toBeNull()
    expect(rest.version).toBe(first.version)
    const index = indexStory(folder, '顾野')
    expect(index.entries.some(e => e.kind === 'draft' && e.status === 'finalized')).toBe(true)
    expect(index.entries.some(e => e.kind === 'character')).toBe(true)
  })
})
function BluePrintEvents() { return BlueprintRepository.getByChapter(3)?.keyEvents }
