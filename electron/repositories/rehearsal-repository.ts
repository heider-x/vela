import path from 'node:path'
import { getProjectDb } from '../database'
import { ProjectCoreRepository } from './project-core-repository'
import type { RehearsalContext, RehearsalExcerpt } from '../../src/shared/story-rehearsal'

/** Check and use the same synchronous database handle, with no await between them. */
export function requireProjectDatabase(projectPath: string) {
  const db = getProjectDb()
  if (!db) throw new Error('PROJECT_CLOSED')
  if (typeof projectPath !== 'string' || !path.isAbsolute(projectPath)) {
    throw new Error('PROJECT_CHANGED')
  }
  const expected = path.resolve(projectPath, '.vela', 'vela.db')
  const actual = path.resolve(db.name)
  const normalize = (value: string) => process.platform === 'win32' ? value.toLowerCase() : value
  if (normalize(expected) !== normalize(actual)) throw new Error('PROJECT_CHANGED')
  return db
}

/** Only previous finalized prose is evidence. Global mutable character state is excluded. */
export function readRehearsalContext(projectPath: string, chapterNumber: number): RehearsalContext {
  const db = requireProjectDatabase(projectPath)
  if (!Number.isSafeInteger(chapterNumber) || chapterNumber < 1) throw new Error('INVALID_CHAPTER')
  const core = ProjectCoreRepository.get()
  const authorPlan: Record<string, string> = {}
  let planTruncated = false
  for (const key of ['genre', 'premise', 'worldbuilding', 'charactersArch', 'synopsis', 'writingStyle', 'globalGuidance'] as const) {
    const value = core?.[key] || ''
    authorPlan[key] = value.slice(0, 2400)
    planTruncated ||= value.length > 2400
  }
  const rows = db.prepare(`
    SELECT d.chapter_number AS chapterNumber, d.id AS draftId, d.version,
      substr(c.body, -2400) AS text, length(c.body) > 2400 AS truncated
    FROM drafts d JOIN contents c ON c.id = d.content_id
    WHERE d.status = 'finalized' AND d.chapter_number < ?
      AND d.id = (
        SELECT d2.id FROM drafts d2
        WHERE d2.chapter_number = d.chapter_number AND d2.status = 'finalized'
        ORDER BY d2.version DESC, d2.id DESC LIMIT 1
      )
    ORDER BY d.chapter_number DESC LIMIT 3
  `).all(chapterNumber) as Array<Omit<RehearsalExcerpt, 'truncated'> & { truncated: number }>
  return {
    projectPath, targetChapter: chapterNumber, authorPlan, planTruncated,
    previousExcerpts: rows.reverse().map(row => ({ ...row, truncated: Boolean(row.truncated) })),
  }
}
