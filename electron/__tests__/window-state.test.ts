import { describe, expect, it } from 'vitest'
import { captureWindowState, normalizeWindowState } from '../window-state'

describe('window state persistence helpers', () => {
  const displays = [{ x: 0, y: 0, width: 1920, height: 1080 }]

  it('keeps valid saved bounds and maximized state', () => {
    expect(normalizeWindowState({
      x: 120,
      y: 80,
      width: 1280,
      height: 720,
      maximized: true,
    }, displays)).toEqual({
      x: 120,
      y: 80,
      width: 1280,
      height: 720,
      maximized: true,
    })
  })

  it('drops off-screen coordinates but preserves size and maximized flag', () => {
    expect(normalizeWindowState({
      x: 5000,
      y: 5000,
      width: 1300,
      height: 800,
      maximized: true,
    }, displays)).toEqual({
      width: 1300,
      height: 800,
      maximized: true,
    })
  })

  it('clamps dimensions to the minimum supported window size', () => {
    expect(normalizeWindowState({
      x: 20,
      y: 30,
      width: 300,
      height: 200,
      maximized: false,
    }, displays)).toEqual({
      x: 20,
      y: 30,
      width: 1024,
      height: 640,
      maximized: false,
    })
  })

  it('captures normal bounds when the window is maximized', () => {
    const state = captureWindowState({
      isMaximized: () => true,
      getBounds: () => ({ x: 0, y: 0, width: 1920, height: 1080 }),
      getNormalBounds: () => ({ x: 100, y: 120, width: 1440, height: 900 }),
    })

    expect(state).toEqual({
      x: 100,
      y: 120,
      width: 1440,
      height: 900,
      maximized: true,
    })
  })
})
