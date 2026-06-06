/**
 * Minimal theme store. Toggles a `dark` class on <html> and persists the
 * choice in localStorage. No SSR (Vite SPA), so no FOUC concerns beyond the
 * initial paint — which is handled by `applyInitialTheme()` running before
 * React mounts (see main.tsx).
 *
 * The UI is a plain sun/moon toggle: it defaults to whatever the client's OS
 * prefers ('system'), and the first tap flips to the explicit opposite of
 * what's currently showing. `resolved` is the concrete light/dark the toggle
 * renders from; `theme` keeps the raw choice ('system' until the user toggles)
 * so the toast surface can mirror it.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type Theme = 'light' | 'dark' | 'system'
type Resolved = 'light' | 'dark'

type ThemeStore = {
  theme: Theme
  resolved: Resolved
  setTheme: (theme: Theme) => void
  toggle: () => void
}

const STORAGE_KEY = 'music-theme' // music

function systemResolved(): Resolved {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function resolveTheme(theme: Theme): Resolved {
  return theme === 'system' ? systemResolved() : theme
}

function applyResolved(resolved: Resolved) {
  document.documentElement.classList.toggle('dark', resolved === 'dark')
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set, get) => ({
      theme: 'system',
      resolved: 'light', // corrected the instant applyInitialTheme() runs (pre-mount)
      setTheme: (theme) => {
        const resolved = resolveTheme(theme)
        applyResolved(resolved)
        set({ theme, resolved })
      },
      // Sun/moon toggle: flip to the explicit opposite of what's showing now.
      toggle: () => get().setTheme(get().resolved === 'dark' ? 'light' : 'dark'),
    }),
    // Only the raw choice is persisted; `resolved` is derived on load.
    { name: STORAGE_KEY, partialize: (s) => ({ theme: s.theme }) },
  ),
)

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
  const resolved = resolveTheme(stored)
  applyResolved(resolved)
  useThemeStore.setState({ resolved })

  // React to system-theme changes while "system" is still the chosen mode.
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (useThemeStore.getState().theme === 'system') {
      const r = systemResolved()
      applyResolved(r)
      useThemeStore.setState({ resolved: r })
    }
  })
}
