import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeProjectDatabase, getProjectDb, initProjectDatabase } from '../database'
import { ProjectCoreRepository } from '../repositories/project-core-repository'
import { DraftRepository } from '../repositories/draft-repository'
import { BlueprintRepository, type BlueprintData } from '../repositories/blueprint-repository'
import { readRehearsalContext } from '../repositories/rehearsal-repository'
import { registerDatabaseController } from '../controllers/db-controller'

const { handlers } = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => unknown>() }))
vi.mock('electron', () => ({ ipcMain: { handle: (channel: string, handler: (...args: unknown[]) => unknown) => handlers.set(channel, handler) } }))
let folder: string
let projectA: string
let projectB: string
const blueprint: BlueprintData = {
  chapterNumber: 5, title: '来信', role: '转折', purpose: '关系断裂', keyEvents: '',
  characters: ['师父'], suspenseHook: '', userGuidance: '原有指导', notes: '不改要点', notesUpdatedAt: '',
}
function addChapter(chapterNumber: number, content: string, status = 'finalized', version = 1) {
  const id = DraftRepository.create({ chapterNumber, version, source: 'write', content, wordCount: content.length })
  DraftRepository.updateStatus(id, status)
  return id
}

beforeEach(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-rehearsal-test-'))
  projectA = path.join(folder, 'A')
  projectB = path.join(folder, 'B')
  initProjectDatabase(projectA)
  ProjectCoreRepository.init('A')
  registerDatabaseController()
})
afterEach(() => {
  closeProjectDatabase()
  const resolved = path.resolve(folder)
  const parent = path.resolve(os.tmpdir())
  if (path.dirname(resolved) !== parent || !path.basename(resolved).startsWith('vela-rehearsal-test-')) throw new Error('Unsafe cleanup path')
  fs.rmSync(resolved, { recursive: true })
  handlers.clear()
})

describe('rehearsal context and blueprint persistence', () => {
  it('commits removals durably while preserving chapter prose', () => {
    BlueprintRepository.upsert(blueprint)
    const draft = addChapter(5, '正文不可删除')
    BlueprintRepository.commit([], [5], [blueprint])
    closeProjectDatabase()
    initProjectDatabase(projectA)
    expect(BlueprintRepository.getByChapter(5)).toBeNull()
    expect(DraftRepository.getFull(draft)?.content).toBe('正文不可删除')
  })
  it('rejects stale saves and deletions atomically without overwriting concurrent edits', () => {
    BlueprintRepository.upsert(blueprint)
    BlueprintRepository.upsert({ ...blueprint, notes: '定稿工作流的新要点' })
    expect(() => BlueprintRepository.commit([{ ...blueprint, chapterNumber: 6 }], [5], [blueprint])).toThrow('BLUEPRINT_CONFLICT')
    expect(BlueprintRepository.getByChapter(6)).toBeNull()
    expect(BlueprintRepository.getByChapter(5)?.notes).toBe('定稿工作流的新要点')
  })
  it('rejects invalid/duplicate chapter numbers and commits scoped to the wrong project', async () => {
    expect(() => BlueprintRepository.commit([blueprint, blueprint], [], [])).toThrow('INVALID_CHAPTER')
    expect(() => BlueprintRepository.commit([{ ...blueprint, chapterNumber: 0 }], [], [])).toThrow('INVALID_CHAPTER')
    expect(await handlers.get('db:blueprint-commit')!({}, [blueprint], [], [], projectB)).toMatchObject({ success: false })
    expect(BlueprintRepository.getAll()).toEqual([])
  })
  it('reads only the latest finalized version of up to three strictly earlier chapters', () => {
    addChapter(1, 'too old')
    addChapter(2, '第二章')
    addChapter(3, '旧版本', 'finalized', 1)
    const latest = addChapter(3, '最新定稿', 'finalized', 2)
    addChapter(3, '未定稿未来修订', 'draft', 3)
    addChapter(4, '长'.repeat(3000))
    addChapter(5, '目标章未来信息')
    addChapter(30, '结局秘密')
    ProjectCoreRepository.update({ characterStates: '第三十章人物死亡', synopsis: '尚未发生的计划' })
    const context = readRehearsalContext(projectA, 5)
    expect(context.previousExcerpts.map(x => x.chapterNumber)).toEqual([2, 3, 4])
    expect(context.previousExcerpts[1]).toMatchObject({ draftId: latest, text: '最新定稿', version: 2 })
    expect(context.previousExcerpts[2].text).toHaveLength(2400)
    expect(context.previousExcerpts[2].truncated).toBe(true)
    expect(JSON.stringify(context)).not.toMatch(/结局秘密|目标章未来信息|未定稿未来修订|第三十章人物死亡|too old/)
    expect(context.authorPlan.synopsis).toBe('尚未发生的计划')
  })

  it('supports chapter one and explicitly marks truncated author plans', () => {
    ProjectCoreRepository.update({ synopsis: '字'.repeat(3000) })
    const context = readRehearsalContext(projectA, 1)
    expect(context.previousExcerpts).toEqual([])
    expect(context.planTruncated).toBe(true)
    expect(context.authorPlan.synopsis).toHaveLength(2400)
    expect(() => readRehearsalContext(projectA, 0)).toThrow('INVALID_CHAPTER')
  })

  it('rejects reads and saves for A after B becomes active', async () => {
    initProjectDatabase(projectB)
    ProjectCoreRepository.init('B')
    expect(() => readRehearsalContext(projectA, 5)).toThrow('PROJECT_CHANGED')
    const save = handlers.get('db:blueprint-upsert')!
    expect(await save({}, blueprint, projectA)).toMatchObject({ success: false })
    expect(BlueprintRepository.getAll()).toEqual([])
  })

  it('persists an adopted blueprint across close/reopen without changing prose or notes', async () => {
    const prose = addChapter(4, '正文保持原样')
    const adopted = { ...blueprint, userGuidance: '原有指导\n\n选定试演方向' }
    expect(await handlers.get('db:blueprint-upsert')!({}, adopted, projectA)).toEqual({ success: true })
    closeProjectDatabase()
    initProjectDatabase(projectA)
    expect(BlueprintRepository.getByChapter(5)).toEqual(adopted)
    expect(DraftRepository.getFull(prose)?.content).toBe('正文保持原样')
  })

  it('reports write failures and closed databases as failures', async () => {
    getProjectDb()!.pragma('query_only = ON')
    expect(await handlers.get('db:blueprint-upsert')!({}, blueprint, projectA)).toMatchObject({ success: false })
    getProjectDb()!.pragma('query_only = OFF')
    closeProjectDatabase()
    expect(await handlers.get('db:blueprint-upsert-many')!({}, [blueprint], projectA)).toMatchObject({ success: false })
  })
})
