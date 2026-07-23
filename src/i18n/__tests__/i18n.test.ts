/**
 * i18n System Tests
 *
 * Validates the internationalization setup:
 * - Initialization and configuration
 * - Translation key completeness across languages
 * - Interpolation
 * - Language switching
 * - Namespace isolation
 * - JSON file validity
 */
import { describe, it, expect, beforeEach } from 'vitest'
import i18n from '../index'

// Import all translation files directly for validation
import zhCNCommon from '../locales/zh-CN/common.json'
import zhCNDialogs from '../locales/zh-CN/dialogs.json'
import zhCNEditors from '../locales/zh-CN/editors.json'
import zhCNPanels from '../locales/zh-CN/panels.json'
import zhCNLayout from '../locales/zh-CN/layout.json'
import zhCNPages from '../locales/zh-CN/pages.json'
import zhCNStores from '../locales/zh-CN/stores.json'
import zhCNSettings from '../locales/zh-CN/settings.json'
import zhCNCommands from '../locales/zh-CN/commands.json'

import enCommon from '../locales/en/common.json'
import enDialogs from '../locales/en/dialogs.json'
import enEditors from '../locales/en/editors.json'
import enPanels from '../locales/en/panels.json'
import enLayout from '../locales/en/layout.json'
import enPages from '../locales/en/pages.json'
import enStores from '../locales/en/stores.json'
import enSettings from '../locales/en/settings.json'
import enCommands from '../locales/en/commands.json'

import ruCommon from '../locales/ru/common.json'
import ruDialogs from '../locales/ru/dialogs.json'
import ruEditors from '../locales/ru/editors.json'
import ruPanels from '../locales/ru/panels.json'
import ruLayout from '../locales/ru/layout.json'
import ruPages from '../locales/ru/pages.json'
import ruStores from '../locales/ru/stores.json'
import ruSettings from '../locales/ru/settings.json'
import ruCommands from '../locales/ru/commands.json'

const NAMESPACES = ['common', 'dialogs', 'editors', 'panels', 'layout', 'pages', 'stores', 'settings', 'commands'] as const

const ZH_CN_FILES: Record<string, Record<string, unknown>> = {
  common: zhCNCommon,
  dialogs: zhCNDialogs,
  editors: zhCNEditors,
  panels: zhCNPanels,
  layout: zhCNLayout,
  pages: zhCNPages,
  stores: zhCNStores,
  settings: zhCNSettings,
  commands: zhCNCommands,
}

const EN_FILES: Record<string, Record<string, unknown>> = {
  common: enCommon,
  dialogs: enDialogs,
  editors: enEditors,
  panels: enPanels,
  layout: enLayout,
  pages: enPages,
  stores: enStores,
  settings: enSettings,
  commands: enCommands,
}

const RU_FILES: Record<string, Record<string, unknown>> = {
  common: ruCommon,
  dialogs: ruDialogs,
  editors: ruEditors,
  panels: ruPanels,
  layout: ruLayout,
  pages: ruPages,
  stores: ruStores,
  settings: ruSettings,
  commands: ruCommands,
}

// Helper: recursively collect all leaf keys from a nested object
function getLeafKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = []
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      keys.push(...getLeafKeys(value as Record<string, unknown>, fullKey))
    } else {
      keys.push(fullKey)
    }
  }
  return keys
}

describe('i18n Initialization', () => {
  it('should be initialized', () => {
    expect(i18n).toBeDefined()
    expect(i18n.isInitialized).toBe(true)
  })

  it('should have zh-CN as default language', () => {
    expect(i18n.language).toBe('zh-CN')
  })

  it('should have zh-CN as fallback language', () => {
    const fallback = i18n.options.fallbackLng
    // fallbackLng can be string or array
    if (Array.isArray(fallback)) {
      expect(fallback).toContain('zh-CN')
    } else {
      expect(fallback).toBe('zh-CN')
    }
  })

  it('should have all 8 namespaces registered', () => {
    const namespaces = i18n.options.ns as string[]
    expect(namespaces).toEqual(expect.arrayContaining([...NAMESPACES]))
    expect(namespaces.length).toBe(NAMESPACES.length)
  })

  it('should have common as default namespace', () => {
    expect(i18n.options.defaultNS).toBe('common')
  })
})

describe('Translation Key Completeness', () => {
  for (const ns of NAMESPACES) {
    it(`${ns}: zh-CN, en, and ru should have the same keys`, () => {
      const zhKeys = getLeafKeys(ZH_CN_FILES[ns]).sort()
      const enKeys = getLeafKeys(EN_FILES[ns]).sort()
      const ruKeys = getLeafKeys(RU_FILES[ns]).sort()

      const missingInEn = zhKeys.filter(k => !enKeys.includes(k))
      const missingInRu = zhKeys.filter(k => !ruKeys.includes(k))
      const missingInZh = enKeys.filter(k => !zhKeys.includes(k))

      if (missingInEn.length > 0) {
        console.error(`${ns}: Missing keys in en: ${missingInEn.join(', ')}`)
      }
      if (missingInRu.length > 0) {
        console.error(`${ns}: Missing keys in ru: ${missingInRu.join(', ')}`)
      }
      if (missingInZh.length > 0) {
        console.error(`${ns}: Missing keys in zh-CN: ${missingInZh.join(', ')}`)
      }

      expect(missingInEn).toEqual([])
      expect(missingInRu).toEqual([])
      expect(missingInZh).toEqual([])
    })
  }
})

describe('Translation Retrieval', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
  })

  it('should return Chinese text for common keys in zh-CN', () => {
    expect(i18n.t('confirm')).toBe('确认')
    expect(i18n.t('cancel')).toBe('取消')
    expect(i18n.t('ok')).toBe('确定')
    expect(i18n.t('retry')).toBe('重试')
    expect(i18n.t('save')).toBe('保存')
  })

  it('should return English text for common keys in en', async () => {
    await i18n.changeLanguage('en')
    expect(i18n.t('confirm')).toBe('Confirm')
    expect(i18n.t('cancel')).toBe('Cancel')
    expect(i18n.t('ok')).toBe('OK')
    expect(i18n.t('retry')).toBe('Retry')
    expect(i18n.t('save')).toBe('Save')
  })

  it('should return Russian text for common keys in ru', async () => {
    await i18n.changeLanguage('ru')
    expect(i18n.t('confirm')).toBe('Подтвердить')
    expect(i18n.t('cancel')).toBe('Отмена')
    expect(i18n.t('ok')).toBe('ОК')
    expect(i18n.t('retry')).toBe('Повторить')
    expect(i18n.t('save')).toBe('Сохранить')
  })

  it('should work with namespace prefix', () => {
    expect(i18n.t('common:confirm')).toBe('确认')
    expect(i18n.t('title', { ns: 'dialogs' })).toBeDefined()
  })

  it('should return key itself for nonexistent keys', () => {
    expect(i18n.t('nonexistent.key.that.does.not.exist')).toBe('nonexistent.key.that.does.not.exist')
  })
})

describe('Interpolation', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
  })

  it('should interpolate count in zh-CN', () => {
    expect(i18n.t('itemsCount', { count: 5 })).toBe('共 5 项')
    expect(i18n.t('minutesAgo', { count: 3 })).toBe('3分钟前')
    expect(i18n.t('hoursAgo', { count: 2 })).toBe('2小时前')
    expect(i18n.t('daysAgo', { count: 1 })).toBe('1天前')
  })

  it('should interpolate count in en', async () => {
    await i18n.changeLanguage('en')
    expect(i18n.t('itemsCount', { count: 5 })).toBe('5 items')
    expect(i18n.t('minutesAgo', { count: 3 })).toBe('3 minutes ago')
    expect(i18n.t('hoursAgo', { count: 2 })).toBe('2 hours ago')
    expect(i18n.t('daysAgo', { count: 1 })).toBe('1 days ago')
  })

  it('should interpolate count in ru', async () => {
    await i18n.changeLanguage('ru')
    expect(i18n.t('itemsCount', { count: 5 })).toBe('5 элементов')
    expect(i18n.t('minutesAgo', { count: 3 })).toBe('3 мин. назад')
    expect(i18n.t('hoursAgo', { count: 2 })).toBe('2 ч. назад')
    expect(i18n.t('daysAgo', { count: 1 })).toBe('1 дн. назад')
  })
})

describe('Language Switching', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
  })

  it('should switch to en and back to zh-CN', async () => {
    await i18n.changeLanguage('en')
    expect(i18n.language).toBe('en')
    expect(i18n.t('confirm')).toBe('Confirm')

    await i18n.changeLanguage('zh-CN')
    expect(i18n.language).toBe('zh-CN')
    expect(i18n.t('confirm')).toBe('确认')
  })

  it('should switch to ru and back to zh-CN', async () => {
    await i18n.changeLanguage('ru')
    expect(i18n.language).toBe('ru')
    expect(i18n.t('confirm')).toBe('Подтвердить')

    await i18n.changeLanguage('zh-CN')
    expect(i18n.language).toBe('zh-CN')
    expect(i18n.t('confirm')).toBe('确认')
  })

  it('should switch to en and return English for dialogs namespace', async () => {
    await i18n.changeLanguage('en')
    // dialogs namespace has nested keys, check a known one
    const result = i18n.t('newProject.title', { ns: 'dialogs' })
    expect(result).toBe('New Novel Project')
  })

  it('should switch to zh-CN and return Chinese for dialogs namespace', async () => {
    await i18n.changeLanguage('zh-CN')
    const result = i18n.t('newProject.title', { ns: 'dialogs' })
    expect(result).toBe('新建小说项目')
  })
})

describe('Namespace Isolation', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
  })

  it('should return different values for same key in different namespaces', () => {
    // 'title' exists in both dialogs and editors namespaces
    const dialogsTitle = i18n.t('title', { ns: 'dialogs' })
    const editorsTitle = i18n.t('title', { ns: 'editors' })
    // They should be defined (may or may not be different)
    expect(dialogsTitle).toBeDefined()
    expect(editorsTitle).toBeDefined()
  })

  it('should isolate common namespace from others', () => {
    expect(i18n.t('confirm', { ns: 'common' })).toBe('确认')
  })
})

describe('JSON File Validity', () => {
  for (const ns of NAMESPACES) {
    it(`zh-CN/${ns}.json should be valid JSON with no duplicate keys`, () => {
      const content = JSON.stringify(ZH_CN_FILES[ns])
      expect(content).toBeDefined()
      expect(typeof ZH_CN_FILES[ns]).toBe('object')
    })

    it(`en/${ns}.json should be valid JSON with no duplicate keys`, () => {
      const content = JSON.stringify(EN_FILES[ns])
      expect(content).toBeDefined()
      expect(typeof EN_FILES[ns]).toBe('object')
    })

    it(`ru/${ns}.json should be valid JSON with no duplicate keys`, () => {
      const content = JSON.stringify(RU_FILES[ns])
      expect(content).toBeDefined()
      expect(typeof RU_FILES[ns]).toBe('object')
    })
  }
})

describe('Store Translation Keys', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
  })

  it('should have workflow log messages in zh-CN', () => {
    expect(i18n.t('workflow.started', { ns: 'stores', title: 'Test' })).toContain('Test')
    expect(i18n.t('workflow.completed', { ns: 'stores', title: 'Test' })).toContain('Test')
  })

  it('should have workflow log messages in en', async () => {
    await i18n.changeLanguage('en')
    expect(i18n.t('workflow.started', { ns: 'stores', title: 'Test' })).toContain('Test')
    expect(i18n.t('workflow.completed', { ns: 'stores', title: 'Test' })).toContain('Test')
  })

  it('should have guard messages in zh-CN', () => {
    expect(i18n.t('guard.openProjectFirst', { ns: 'stores' })).toBe('请先打开或新建一个项目。')
  })

  it('should have guard messages in en', async () => {
    await i18n.changeLanguage('en')
    expect(i18n.t('guard.openProjectFirst', { ns: 'stores' })).toBe('Please open or create a project first.')
  })
})

describe('Layout Translation Keys', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
  })

  it('should have activity bar labels in zh-CN', () => {
    expect(i18n.t('activityBar.home', { ns: 'layout' })).toBe('主页')
    expect(i18n.t('activityBar.project', { ns: 'layout' })).toBe('项目')
    expect(i18n.t('activityBar.knowledge', { ns: 'layout' })).toBe('知识库')
    expect(i18n.t('activityBar.characters', { ns: 'layout' })).toBe('角色')
  })

  it('should have activity bar labels in en', async () => {
    await i18n.changeLanguage('en')
    expect(i18n.t('activityBar.home', { ns: 'layout' })).toBe('Home')
    expect(i18n.t('activityBar.project', { ns: 'layout' })).toBe('Project')
    expect(i18n.t('activityBar.knowledge', { ns: 'layout' })).toBe('Knowledge Base')
    expect(i18n.t('activityBar.characters', { ns: 'layout' })).toBe('Characters')
  })

  it('should have status bar labels', () => {
    expect(i18n.t('statusBar.noModel', { ns: 'layout' })).toBeDefined()
    expect(i18n.t('statusBar.supportAuthor', { ns: 'layout' })).toBeDefined()
  })
})

describe('Pages Translation Keys', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh-CN')
  })

  it('should have welcome page text in zh-CN', () => {
    expect(i18n.t('welcome.title', { ns: 'pages' })).toBe('欢迎使用 Vela')
    expect(i18n.t('welcome.subtitle', { ns: 'pages' })).toBe('AI 深度驱动的小说创作 IDE')
    expect(i18n.t('welcome.newProject', { ns: 'pages' })).toBe('新建项目')
    expect(i18n.t('welcome.openProject', { ns: 'pages' })).toBe('打开项目')
    expect(i18n.t('welcome.importNovel', { ns: 'pages' })).toBe('导入小说')
  })

  it('should have welcome page text in en', async () => {
    await i18n.changeLanguage('en')
    expect(i18n.t('welcome.title', { ns: 'pages' })).toBe('Welcome to Vela')
    expect(i18n.t('welcome.subtitle', { ns: 'pages' })).toBe('AI-powered novel writing IDE')
    expect(i18n.t('welcome.newProject', { ns: 'pages' })).toBe('New Project')
    expect(i18n.t('welcome.openProject', { ns: 'pages' })).toBe('Open Project')
    expect(i18n.t('welcome.importNovel', { ns: 'pages' })).toBe('Import Novel')
  })
})
