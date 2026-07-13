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

import enCommon from './locales/en/common.json'
import enDialogs from './locales/en/dialogs.json'
import enEditors from './locales/en/editors.json'
import enPanels from './locales/en/panels.json'
import enLayout from './locales/en/layout.json'
import enPages from './locales/en/pages.json'
import enStores from './locales/en/stores.json'
import enSettings from './locales/en/settings.json'

import ruCommon from './locales/ru/common.json'
import ruDialogs from './locales/ru/dialogs.json'
import ruEditors from './locales/ru/editors.json'
import ruPanels from './locales/ru/panels.json'
import ruLayout from './locales/ru/layout.json'
import ruPages from './locales/ru/pages.json'
import ruStores from './locales/ru/stores.json'
import ruSettings from './locales/ru/settings.json'

const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined'

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
    },
  },
  fallbackLng: 'zh-CN',
  ns: ['common', 'dialogs', 'editors', 'panels', 'layout', 'pages', 'stores', 'settings'],
  defaultNS: 'common',
  interpolation: {
    escapeValue: false,
  },
}

// Only use LanguageDetector and React i18next in browser environment
if (isBrowser) {
  // Dynamic import to avoid bundling browser-only code in tests
  import('i18next-browser-languagedetector').then(({ default: LanguageDetector }) => {
    i18n.use(LanguageDetector)
  }).catch(() => {
    // Ignore if not available
  })
  i18n.use(initReactI18next)

  i18nConfig.detection = {
    order: ['localStorage'],
    lookupLocalStorage: 'vela-locale',
    caches: ['localStorage'],
  }
}

i18n.init(i18nConfig)

// Update HTML lang attribute when language changes (browser only)
if (isBrowser) {
  i18n.on('languageChanged', (lng) => {
    document.documentElement.lang = lng === 'ru' ? 'ru' : lng === 'en' ? 'en' : 'zh-CN'
    const titles: Record<string, string> = {
      'ru': 'Vela — ИИ-редактор для написания романов',
      'en': 'Vela — AI Novel Writing IDE',
      'zh-CN': 'Vela — AI 小说创作 IDE',
    }
    document.title = titles[lng] || titles['zh-CN']
  })
}

export default i18n
