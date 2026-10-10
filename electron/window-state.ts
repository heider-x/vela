import type { BrowserWindow, Rectangle } from 'electron'
import type { GlobalConfig } from '../src/shared/ipc-channels'

export const DEFAULT_WINDOW_STATE: Required<Pick<NonNullable<GlobalConfig['windowState']>, 'width' | 'height' | 'maximized'>> = {
  width: 1440,
  height: 900,
  maximized: false,
}

const MIN_WIDTH = 1024
const MIN_HEIGHT = 640

export interface DisplayArea {
  x: number
  y: number
  width: number
  height: number
}

export function normalizeWindowState(
  state: GlobalConfig['windowState'] | null | undefined,
  displayAreas: DisplayArea[],
): NonNullable<GlobalConfig['windowState']> {
  const width = clampDimension(state?.width, MIN_WIDTH, DEFAULT_WINDOW_STATE.width)
  const height = clampDimension(state?.height, MIN_HEIGHT, DEFAULT_WINDOW_STATE.height)
  const candidate = {
    width,
    height,
    x: typeof state?.x === 'number' ? Math.round(state.x) : undefined,
    y: typeof state?.y === 'number' ? Math.round(state.y) : undefined,
    maximized: Boolean(state?.maximized),
  }

  if (
    typeof candidate.x === 'number' &&
    typeof candidate.y === 'number' &&
    displayAreas.length > 0 &&
    !intersectsAnyDisplay({ x: candidate.x, y: candidate.y, width, height }, displayAreas)
  ) {
    return { width, height, maximized: candidate.maximized }
  }

  return candidate
}

export function captureWindowState(win: Pick<BrowserWindow, 'getBounds' | 'isMaximized'> & Partial<Pick<BrowserWindow, 'getNormalBounds'>>): NonNullable<GlobalConfig['windowState']> {
  const bounds = win.isMaximized() && win.getNormalBounds ? win.getNormalBounds() : win.getBounds()
  return {
    x: bounds.x,
    y: bounds.y,
    width: Math.max(MIN_WIDTH, bounds.width),
    height: Math.max(MIN_HEIGHT, bounds.height),
    maximized: win.isMaximized(),
  }
}

function clampDimension(value: number | undefined, min: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.round(value))
}

function intersectsAnyDisplay(bounds: Rectangle, displayAreas: DisplayArea[]): boolean {
  return displayAreas.some(area => (
    bounds.x < area.x + area.width &&
    bounds.x + bounds.width > area.x &&
    bounds.y < area.y + area.height &&
    bounds.y + bounds.height > area.y
  ))
}
