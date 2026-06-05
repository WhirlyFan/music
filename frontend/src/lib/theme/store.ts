/**
 * Minimal theme store. Toggles a `dark` class on <html> and persists the
 * choice in localStorage. No SSR (Vite SPA), so no FOUC concerns beyond the
 * initial paint — which is handled by `applyInitialTheme()` running before
 * React mounts (see main.tsx).
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type Theme = 'light' | 'dark' | 'system'

type ThemeStore = {
  theme: Theme
  setTheme: (theme: Theme) => void
}

const STORAGE_KEY = 'music-theme' // music

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set) => ({
      theme: 'system',
      setTheme: (theme) => {
        applyTheme(theme)
        set({ theme })
      },
    }),
    { name: STORAGE_KEY },
  ),
)

function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme !== 'system') return theme
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyTheme(theme: Theme) {
  const resolved = resolveTheme(theme)
  const root = document.documentElement
  root.classList.toggle('dark', resolved === 'dark')
}

/**
 * Read the stored theme and apply it before React mounts. Called from
 * main.tsx so the page never flashes the wrong palette on load.
 */
export function applyInitialTheme() {
  let stored: Theme = 'system'
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as { state?: { theme?: Theme } }
      if (parsed.state?.theme) stored = parsed.state.theme
    }
  } catch {
    /* fall back to system */
  }
  applyTheme(stored)

  // React to system-theme changes while "system" is the chosen mode.
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (useThemeStore.getState().theme === 'system') applyTheme('system')
  })
}
