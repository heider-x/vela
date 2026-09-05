import React from 'react'
import { createRoot } from 'react-dom/client'
import '../../src/index.css'
import i18n from '../../src/i18n'
import FeatureTour from '../../src/components/onboarding/FeatureTour'
import { useOnboardingStore } from '../../src/stores/onboarding-store'
import { useLayoutStore } from '../../src/stores/layout-store'
import { useAgentStore } from '../../src/stores/agent-store'

const params = new URLSearchParams(location.search)
document.documentElement.className = params.get('theme') || 'dark'
if (params.has('fresh')) localStorage.removeItem('vela-feature-tour-v1')
useAgentStore.setState({ generating: params.has('busy') })
const test = {
  copied: '', copyFailed: false,
  setBusy: (value: boolean) => useAgentStore.setState({ generating: value }),
  configured: () => useLayoutStore.getState().settingsOpen,
}
Object.assign(window, { onboardingTest: test })
Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => {
  if (test.copyFailed) throw new Error('Clipboard unavailable')
  test.copied = text
} } })

void i18n.changeLanguage(params.get('lang') || 'zh-CN').then(() => {
  createRoot(document.getElementById('root')!).render(<React.StrictMode>
    <main style={{ height: '100vh', color: 'var(--color-text)', background: 'var(--color-bg)' }}>
      <header className="flex justify-end gap-6 p-3 border-b border-[var(--color-border)]">
        <button data-tour="guide-entry" onClick={() => useOnboardingStore.getState().start()}>功能导览</button>
        <button data-tour="model-settings">设置</button>
      </header>
      <aside className="absolute left-2 top-20 w-28"><button data-tour="project-entry">项目</button><p data-tour="blueprints" className="mt-5">章节蓝图</p></aside>
      <section className="absolute right-5 top-20 w-56 max-w-[40vw] border border-[var(--color-border)] p-3 rounded">
        <div className="flex justify-between"><button data-tour="agent-entry">AI 助手</button><button data-tour="revision-history">修改记录</button></div>
        <textarea data-tour="agent-input" aria-label="Existing message" defaultValue="保留我未发送的创作意图" className="w-full h-40 mt-4" />
      </section>
      <button data-tour="rehearsal" className="absolute bottom-6 left-1/2">剧情试演</button>
      <FeatureTour />
    </main>
  </React.StrictMode>)
})
