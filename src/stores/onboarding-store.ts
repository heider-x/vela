import { create } from 'zustand'

export const ONBOARDING_STORAGE_KEY = 'vela-feature-tour-v1'

export function hasSeenFeatureTour(): boolean {
  try { return localStorage.getItem(ONBOARDING_STORAGE_KEY) === 'seen' } catch { return false }
}

export const useOnboardingStore = create<{
  open: boolean
  dismissedThisSession: boolean
  start: () => void
  dismiss: () => void
}>()((set) => ({
  open: false,
  dismissedThisSession: false,
  start: () => set({ open: true }),
  dismiss: () => {
    try { localStorage.setItem(ONBOARDING_STORAGE_KEY, 'seen') } catch { /* Still allow dismissal without storage. */ }
    set({ open: false, dismissedThisSession: true })
  },
}))
