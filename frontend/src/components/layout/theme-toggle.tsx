import { Moon, Sun } from 'lucide-react'

import { useThemeStore } from '@/lib/theme/store'

/**
 * Standalone sun/moon theme toggle. Lives in the root layout's top-right corner
 * when logged out (signed-in users get the same toggle inside the gooey FAB), so
 * the preference is reachable without an account. Defaults to the client's OS
 * scheme; a tap flips to the explicit opposite.
 */
export function ThemeToggle() {
  const resolved = useThemeStore((s) => s.resolved)
  const toggle = useThemeStore((s) => s.toggle)
  const isDark = resolved === 'dark'

  return (
    // 44x44 touch target per WCAG 2.5.5. Visual icon stays at 16px.
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      className="text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:ring-ring focus-visible:ring-offset-background inline-flex h-11 w-11 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
    >
      {isDark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
    </button>
  )
}
