import { ipc } from '../ipc-client'
import { useProjectStore } from '../../stores/project-store'
import { useEditorStore } from '../../stores/editor-store'
import { useWorkflowStore } from '../../stores/workflow-store'
import { useCharacterStore } from '../../stores/character-store'
import { globalEventBus } from '../../shared/event-bus'
import type { StoryRevision, StoryRevisionRequest } from '../../shared/story-revision'
import type { NovelConfig } from '../../shared/ipc-channels'

const configMap: Record<string, keyof NovelConfig> = { genre: 'genre', subGenre: 'subGenre', writingStyle: 'writingStyle', narrativePov: 'narrativePOV', globalGuidance: 'globalGuidance', goldenFinger: 'goldenFinger', synopsis: 'coreOutline', worldbuilding: 'worldSetting', charactersArch: 'protagonistProfile' }
export function assertStoryProject(projectPath: string) {
  const state = useProjectStore.getState()
  if (state.loading || state.currentProject?.path !== projectPath) throw new Error('项目已切换，本次操作已停止。')
}

async function ready(projectPath: string) {
  assertStoryProject(projectPath)
  if (useWorkflowStore.getState().hasActiveRun()) throw new Error('请等当前写作任务结束后再调整方向，避免两项任务互相覆盖。')
  if (useEditorStore.getState().tabs.some(tab => tab.dirty)) throw new Error('编辑器中有未保存的修改。请先保存或放弃编辑，再继续这次调整。')
  const core = await ipc.invoke('db:project-core-get')
  assertStoryProject(projectPath)
  const config = useProjectStore.getState().currentProject!.novelConfig
  for (const [field, configKey] of Object.entries(configMap)) {
    if (core && String(config[configKey] ?? '') !== String(core[field as keyof typeof core] ?? '')) {
      // The configuration editor writes directly into the store before saving.
      // Do not refresh that store over a user's unpublished edits.
      throw new Error('小说配置与已保存内容不同，请先保存配置或重新打开项目，再调整方向。')
    }
  }
  if (useCharacterStore.getState().loaded) {
    const saved = await ipc.invoke('db:character-get-all')
    assertStoryProject(projectPath)
    const local = useCharacterStore.getState().characters
    if (saved.length !== local.length || saved.some(card => JSON.stringify(card) !== JSON.stringify(local.find(c => c.name === card.name)))) throw new Error('角色卡中有未保存的修改，请先保存或重新加载后再调整。')
  }
  // Recheck immediately before the caller dispatches the write, including after reads.
  assertStoryProject(projectPath)
  if (useWorkflowStore.getState().hasActiveRun() || useEditorStore.getState().tabs.some(tab => tab.dirty)) throw new Error('项目开始了新任务或编辑，请先完成后再调整。')
}

export function refreshAfterStoryRevision(projectPath: string, revision: StoryRevision) {
  if (useProjectStore.getState().currentProject?.path !== projectPath) return
  const updates: Partial<NovelConfig> = {}
  for (const change of revision.changes) {
    const value = revision.status === 'undone' ? change.before : change.after
    if (change.kind === 'draft') {
      const filePath = `vela://draft/${change.id}`
      const editor = useEditorStore.getState()
      for (const tab of editor.tabs) if (!tab.dirty && tab.type === 'chapter' && tab.filePath === filePath) editor.syncTabContent(tab.id, value)
      if (revision.status === 'applied') editor.openFile({ id: filePath, filePath, name: change.title, type: 'chapter', content: value })
      continue
    }
    if (change.kind !== 'core') continue
    const field = configMap[change.field]
    if (field) Object.assign(updates, { [field]: value })
    const pathMap: Record<string, string> = { premise: 'premise', worldbuilding: 'worldbuilding', charactersArch: 'characters', synopsis: 'synopsis' }
    if (pathMap[change.field]) {
      for (const tab of useEditorStore.getState().tabs) {
        if (!tab.dirty && [ `vela://core/${pathMap[change.field]}`, `vela://core/${pathMap[change.field]}.md` ].includes(tab.filePath ?? '')) useEditorStore.getState().syncTabContent(tab.id, value)
      }
    }
  }
  useProjectStore.getState().updateNovelConfig(updates)
  globalEventBus.emit('STORY_REVISED', { projectPath, revision })
  globalEventBus.emit('REFRESH_RESOURCE', { resources: ['all'] })
}

export async function applyRevision(projectPath: string, request: StoryRevisionRequest, signal?: AbortSignal) {
  await ready(projectPath)
  if (signal?.aborted) throw new Error('调整已取消，未提交修改。')
  const result = await ipc.invoke('story:apply', projectPath, request)
  refreshAfterStoryRevision(projectPath, result)
  return result
}
export async function undoRevision(projectPath: string, id: string, signal?: AbortSignal) {
  await ready(projectPath)
  if (signal?.aborted) throw new Error('撤回操作已取消。')
  const result = await ipc.invoke('story:undo', projectPath, id)
  refreshAfterStoryRevision(projectPath, result)
  return result
}
