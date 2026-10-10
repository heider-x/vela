import { describe, expect, it, afterEach } from 'vitest'
import i18n, { SUPPORTED_LANGUAGES } from '../../../i18n'
import { buildAgentSystemPrompt } from '../context-builder'

const CJK_RE = /[\u3400-\u9fff]/

describe('agent system prompt localization', () => {
  afterEach(async () => {
    await i18n.changeLanguage('zh-CN')
  })

  it('emits an explicit response-language rule for every supported language', async () => {
    const expectations = {
      'zh-CN': '使用中文回复。',
      en: 'Reply in English.',
      ru: 'Отвечай на русском языке.',
    } as const

    for (const language of SUPPORTED_LANGUAGES) {
      await i18n.changeLanguage(language)
      const prompt = buildAgentSystemPrompt('planning')
      expect(prompt).toContain(expectations[language])
    }
  })

  it('does not leak Chinese instructions into English or Russian agent prompts', async () => {
    for (const language of ['en', 'ru'] as const) {
      await i18n.changeLanguage(language)
      const prompt = buildAgentSystemPrompt('fast')
      expect(prompt).not.toContain('使用中文回复')
      expect(prompt).not.toContain('当前处于')
      expect(prompt).not.toContain('核心能力')
      expect(prompt).not.toMatch(CJK_RE)
    }
  })

  it('appends the user base prompt after the localized built-in prompt', async () => {
    await i18n.changeLanguage('en')
    const prompt = buildAgentSystemPrompt('planning', 'Always keep character names unchanged.')

    expect(prompt).toContain('Reply in English.')
    expect(prompt).toContain('## User custom base prompt')
    expect(prompt).toContain('Always keep character names unchanged.')
  })
})
