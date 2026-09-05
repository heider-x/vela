// This entry is only served by the test config, never imported by the application.
import React from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import i18n from '../../src/i18n'
import ChapterCardEditor from '../../src/components/editor/ChapterCardEditor'
import ModelSettings from '../../src/components/settings/ModelSettings'
import SettingsModal from '../../src/components/settings/SettingsModal'
import { useProjectStore } from '../../src/stores/project-store'
import { useLLMStore } from '../../src/stores/llm-store'

const base = {
  chapterNumber: 5, title: '雨夜来信', role: '转折', purpose: '让师徒关系发生变化', keyEvents: '师父交出行踪',
  characters: ['林舟', '师父'], suspenseHook: '信交给了谁', userGuidance: '原有指导：保留雨夜。', notes: '原有要点不变', notesUpdatedAt: '',
}
const project = (name: string) => ({
  id: name, name, path: `D:/vela-ui-fixture/${name}`,
  novelConfig: { genre: '悬疑', subGenre: '', targetAudience: '', totalChapters: 30, wordsPerChapter: 3000,
    plotStructure: 'three_act' as const, narrativePOV: 'third_limited' as const, coreOutline: '', worldSetting: '',
    goldenFinger: '', protagonistProfile: '', globalGuidance: '' },
  characterStates: '', createdAt: '', updatedAt: '',
})
const branches = [
  ['救下人证', '以主角的自由换取七户人证脱险', '师父曾因犹豫失去人证，这次把多数人的生存放在师徒信任之上。'],
  ['掩盖旧案', '为隐瞒旧案而交出主角', '师父害怕声名毁于一旦，同时自欺地相信日后还能补偿。'],
  ['信念决裂', '为维护秩序阻止主角公开证据', '师父相信公开会伤及无辜，主角则拒绝以沉默换取稳定。'],
].map(([title, premise, motive]) => ({ title, premise, motive,
  opposition: '对手保留证据副本，不轻易兑现承诺。', cost: '林舟失去自由，也失去对师父的信任。',
  aftermath: '获救的人证开始追问是谁付出了代价，师父必须承担回答的责任。',
  setup: '已有依据：第 4 章的密信。待补：对手控制人证的具体手段。',
  risk: '理解动机并不等于原谅，后续需要保留关系裂痕。', events: '雨夜交信，林舟被截，师父留下药包。',
}))
const saved = new Map([['A', [structuredClone(base)]], ['B', [{ ...base, title: 'B 项目章节', userGuidance: 'B 原有指导' }]]])
const listeners = new Map<string, Set<(value: unknown) => void>>()
const calls: Array<{ channel: string; args: unknown[] }> = []
const qa = {
  mode: 'success', failSave: false, ollamaMode: 'success', calls, saved,
  switchProject: (name: string) => useProjectStore.setState({ currentProject: project(name), loading: false }),
  noModels: () => useLLMStore.setState({ models: [], defaultModelId: null }),
}
const emit = (channel: string, value: unknown) => listeners.get(channel)?.forEach(fn => fn(value))
Object.assign(window, { rehearsalTest: qa, velaAPI: {
  on: (channel: string, fn: (value: unknown) => void) => {
    if (!listeners.has(channel)) listeners.set(channel, new Set())
    listeners.get(channel)!.add(fn)
    return () => listeners.get(channel)!.delete(fn)
  },
  invoke: async (channel: string, ...args: unknown[]) => {
    calls.push({ channel, args: structuredClone(args) })
    const current = useProjectStore.getState().currentProject!
    if (channel === 'db:blueprint-get-all') return structuredClone(saved.get(current.id))
    if (channel === 'db:draft-get-max-finalized-chapter') return 4
    if (channel === 'db:blueprint-commit') {
      if (qa.failSave) return { success: false, error: 'TEST_DISK_FAILURE' }
      if (args[3] !== current.path) return { success: false, error: 'PROJECT_CHANGED' }
      const items = args[0] as typeof base[]
      const deleted = args[1] as number[]
      const expected = args[2] as typeof base[]
      const existing = saved.get(current.id)!
      for (const number of [...items.map(bp => bp.chapterNumber), ...deleted]) {
        if (JSON.stringify(existing.find(bp => bp.chapterNumber === number)) !== JSON.stringify(expected.find(bp => bp.chapterNumber === number))) return { success: false, error: 'BLUEPRINT_CONFLICT' }
      }
      saved.set(current.id, [...existing.filter(bp => !deleted.includes(bp.chapterNumber) && !items.some(item => item.chapterNumber === bp.chapterNumber)), ...structuredClone(items)].sort((a, b) => a.chapterNumber - b.chapterNumber))
      return { success: true }
    }
    if (channel === 'llm:ollama-models') {
      const mode = qa.ollamaMode
      await new Promise(resolve => setTimeout(resolve, mode === 'delayed' ? 1600 : 100))
      if (mode === 'error') return { success: false, models: [], error: 'CONNECTION_FAILED' }
      return { success: true, models: mode === 'empty' ? [] : mode === 'delayed' ? ['OLD-SERVER:latest'] : ['qwen3:8b', 'deepseek-r1:14b', 'nomic-embed-text:latest'] }
    }
    if (channel === 'llm:save-model') {
      if (qa.failSave) return { success: false, error: 'TEST_DISK_FAILURE' }
      useLLMStore.setState({ models: [...useLLMStore.getState().models, args[0] as never] })
      return { success: true }
    }
    if (channel === 'llm:list-models') return useLLMStore.getState().models
    if (channel === 'db:rehearsal-context') return { projectPath: current.path, targetChapter: args[1],
      authorPlan: { genre: '悬疑', synopsis: '这是设定计划，未发生。' }, planTruncated: false,
      previousExcerpts: [{ chapterNumber: 4, draftId: 4, version: 1, text: '林舟看见师父把密信藏进袖里。', truncated: false }] }
    if (channel === 'db:blueprint-upsert' || channel === 'db:blueprint-upsert-many') {
      if (qa.failSave) return { success: false, error: 'TEST_DISK_FAILURE' }
      if (args[1] !== current.path) return { success: false, error: 'PROJECT_CHANGED' }
      saved.set(current.id, structuredClone(channel.endsWith('-many') ? args[0] : [args[0]]) as typeof base[])
      return { success: true }
    }
    if (channel === 'llm:generate-stream') {
      const requestId = args[0]
      const request = args[1] as { messages: Array<{ content: string }> }
      const mode = qa.mode
      const isDirections = request.messages[0].content.includes('exactly three directions')
      const fullText = mode === 'malformed' ? '{invalid' : isDirections ? JSON.stringify({ directions: branches }) :
        `【模拟模型短场景】\n雨水从檐口落下。林舟把那包药留在桌上，走时没有关门。\n选定方案：${JSON.parse(request.messages[1].content.split('\n').at(-1)!).selectedDirection.title}`
      setTimeout(() => {
        if (mode === 'error') emit('llm:stream-error', { requestId, error: 'TEST_MODEL_FAILURE' })
        else {
          emit('llm:stream-chunk', { requestId, chunk: fullText })
          emit('llm:stream-done', { requestId, fullText })
        }
      }, mode === 'delayed' ? 1800 : 120)
      return { requestId, started: true }
    }
    if (channel === 'llm:cancel') return { success: true } // Deliberately emit late results to test ownership.
    return { success: true }
  },
  send: () => {}, once: () => {}, getZoomLevel: () => 0, setZoomLevel: () => {}, setZoomFactor: () => {},
} })
useProjectStore.setState({ currentProject: project('A'), loading: false })
useLLMStore.setState({ loaded: true, defaultModelId: 'fixture', models: [{
  id: 'fixture', name: '模拟模型 · 仅供界面测试', provider: 'custom', protocol: 'openai', modelName: 'fixture',
  apiKey: '', baseUrl: '', temperature: 0.8, maxTokens: 6000, purposes: ['generation'],
}] })
await i18n.changeLanguage(new URLSearchParams(location.search).get('language') || 'zh-CN')
document.documentElement.className = new URLSearchParams(location.search).get('theme') || 'light'
document.body.style.margin = '0'
createRoot(document.getElementById('root')!).render(<React.StrictMode>
  <div className="h-screen flex flex-col bg-[var(--color-bg)] text-[var(--color-text)]" style={{ width: new URLSearchParams(location.search).get('panelWidth') || undefined }}>
    <div className="px-4 py-2 text-xs border-b border-[var(--color-border)]">界面测试 · 使用独立样例与模拟模型</div>
    <div className="flex-1 min-h-0">{new URLSearchParams(location.search).get('view') === 'models' ? <ModelSettings /> :
      new URLSearchParams(location.search).get('view') === 'settings' ? <SettingsModal open onClose={() => {}} /> : <ChapterCardEditor />}</div>
  </div>
</React.StrictMode>)
