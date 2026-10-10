import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeProjectDatabase, initProjectDatabase } from '../database'
import { BlueprintRepository, type BlueprintData } from '../repositories/blueprint-repository'

function makeBlueprint(chapterNumber: number, title = `Chapter ${chapterNumber}`): BlueprintData {
  return {
    chapterNumber,
    title,
    role: 'development',
    purpose: `Purpose ${chapterNumber}`,
    keyEvents: `Events ${chapterNumber}`,
    characters: [`Hero ${chapterNumber}`],
    suspenseHook: `Hook ${chapterNumber}`,
    userGuidance: '',
    notes: '',
    notesUpdatedAt: '',
  }
}

describe('BlueprintRepository', () => {
  let tempProjectPath: string | null = null

  afterEach(() => {
    closeProjectDatabase()
    if (tempProjectPath) {
      fs.rmSync(tempProjectPath, { recursive: true, force: true })
      tempProjectPath = null
    }
  })

  it('replaceAll removes blueprints that are missing from the saved snapshot', () => {
    tempProjectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'vela-blueprints-'))
    initProjectDatabase(tempProjectPath)

    BlueprintRepository.upsertMany([
      makeBlueprint(1, 'Keep me'),
      makeBlueprint(2, 'Delete me'),
    ])

    BlueprintRepository.replaceAll([
      makeBlueprint(1, 'Updated title'),
    ])

    expect(BlueprintRepository.getAll()).toEqual([
      expect.objectContaining({
        chapterNumber: 1,
        title: 'Updated title',
      }),
    ])
    expect(BlueprintRepository.getByChapter(2)).toBeNull()
  })
})
