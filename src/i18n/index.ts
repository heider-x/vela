import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import zhCNCommon from './locales/zh-CN/common.json'
import zhCNDialogs from './locales/zh-CN/dialogs.json'
import zhCNEditors from './locales/zh-CN/editors.json'
import zhCNPanels from './locales/zh-CN/panels.json'
import zhCNLayout from './locales/zh-CN/layout.json'
import zhCNPages from './locales/zh-CN/pages.json'
import zhCNStores from './locales/zh-CN/stores.json'
import zhCNSettings from './locales/zh-CN/settings.json'
import zhCNCommands from './locales/zh-CN/commands.json'

import enCommon from './locales/en/common.json'
import enDialogs from './locales/en/dialogs.json'
import enEditors from './locales/en/editors.json'
import enPanels from './locales/en/panels.json'
import enLayout from './locales/en/layout.json'
import enPages from './locales/en/pages.json'
import enStores from './locales/en/stores.json'
import enSettings from './locales/en/settings.json'
import enCommands from './locales/en/commands.json'

import ruCommon from './locales/ru/common.json'
import ruDialogs from './locales/ru/dialogs.json'
import ruEditors from './locales/ru/editors.json'
import ruPanels from './locales/ru/panels.json'
import ruLayout from './locales/ru/layout.json'
import ruPages from './locales/ru/pages.json'
import ruStores from './locales/ru/stores.json'
import ruSettings from './locales/ru/settings.json'
import ruCommands from './locales/ru/commands.json'

import ptBRCommon from './locales/pt-BR/common.json'
import ptBRDialogs from './locales/pt-BR/dialogs.json'
import ptBREditors from './locales/pt-BR/editors.json'
import ptBRPanels from './locales/pt-BR/panels.json'
import ptBRLayout from './locales/pt-BR/layout.json'
import ptBRPages from './locales/pt-BR/pages.json'
import ptBRStores from './locales/pt-BR/stores.json'
import ptBRSettings from './locales/pt-BR/settings.json'
import ptBRCommands from './locales/pt-BR/commands.json'

const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined'

export const SUPPORTED_LANGUAGES = ['zh-CN', 'en', 'ru', 'pt-BR'] as const
export type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number]

export function normalizeLanguage(language: string | null | undefined): SupportedLanguage {
  const value = (language ?? '').trim()
  if (value === 'zh-CN' || value.toLowerCase() === 'zh-cn' || value.toLowerCase().startsWith('zh')) return 'zh-CN'
  if (value === 'en' || value.toLowerCase().startsWith('en-')) return 'en'
  if (value === 'ru' || value.toLowerCase().startsWith('ru-')) return 'ru'
  if (value.toLowerCase() === 'pt-br' || value.toLowerCase().startsWith('pt')) return 'pt-BR'
  return 'zh-CN'
}

function getStoredLanguage(): SupportedLanguage {
  if (!isBrowser) return 'zh-CN'
  try {
    const stored = window.localStorage.getItem('vela-locale')
    if (stored) return normalizeLanguage(stored)
    // 首次启动时若系统/浏览器语言为葡萄牙语，则直接以翻译后的界面打开
    if (navigator.language?.toLowerCase().startsWith('pt')) return 'pt-BR'
    return 'zh-CN'
  } catch {
    return 'zh-CN'
  }
}

export function getCurrentLanguage(): SupportedLanguage {
  return normalizeLanguage(i18n.language)
}

export function getIntlLocale(language: string | null | undefined = i18n.language): string {
  const normalized = normalizeLanguage(language)
  if (normalized === 'en') return 'en-US'
  if (normalized === 'ru') return 'ru-RU'
  if (normalized === 'pt-BR') return 'pt-BR'
  return 'zh-CN'
}

const i18nConfig: Parameters<typeof i18n.init>[0] = {
  resources: {
    'zh-CN': {
      common: zhCNCommon,
      dialogs: zhCNDialogs,
      editors: zhCNEditors,
      panels: zhCNPanels,
      layout: zhCNLayout,
      pages: zhCNPages,
      stores: zhCNStores,
      settings: zhCNSettings,
      commands: zhCNCommands,
    },
    en: {
      common: enCommon,
      dialogs: enDialogs,
      editors: enEditors,
      panels: enPanels,
      layout: enLayout,
      pages: enPages,
      stores: enStores,
      settings: enSettings,
      commands: enCommands,
    },
    ru: {
      common: ruCommon,
      dialogs: ruDialogs,
      editors: ruEditors,
      panels: ruPanels,
      layout: ruLayout,
      pages: ruPages,
      stores: ruStores,
      settings: ruSettings,
      commands: ruCommands,
    },
    'pt-BR': {
      common: ptBRCommon,
      dialogs: ptBRDialogs,
      editors: ptBREditors,
      panels: ptBRPanels,
      layout: ptBRLayout,
      pages: ptBRPages,
      stores: ptBRStores,
      settings: ptBRSettings,
      commands: ptBRCommands,
    },
  },
  fallbackLng: 'zh-CN',
  lng: getStoredLanguage(),
  ns: ['common', 'dialogs', 'editors', 'panels', 'layout', 'pages', 'stores', 'settings', 'commands'],
  defaultNS: 'common',
  interpolation: {
    escapeValue: false,
  },
}

// Only use LanguageDetector and React i18next in browser environment
if (isBrowser) {
  i18n.use(initReactI18next)
}

i18n.init(i18nConfig)

// Update HTML lang attribute when language changes (browser only)
if (isBrowser) {
  const applyDocumentLanguage = (lng: string) => {
    const normalized = normalizeLanguage(lng)
    document.documentElement.lang = normalized
    const titles: Record<string, string> = {
      'ru': 'Vela — ИИ-редактор для написания романов',
      'en': 'Vela — AI Novel Writing IDE',
      'pt-BR': 'Vela — IDE de escrita de romances com IA',
      'zh-CN': 'Vela — AI 小说创作 IDE',
    }
    document.title = titles[normalized]
    try {
      window.localStorage.setItem('vela-locale', normalized)
    } catch {
      // Ignore storage failures in restricted environments.
    }
  }

  applyDocumentLanguage(i18n.language)
  i18n.on('languageChanged', (lng) => {
    applyDocumentLanguage(lng)
  })
}

export default i18n
