import { Check, Laptop, Moon, Sun } from 'lucide-react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useThemeStore } from '@/lib/theme/store'

/**
 * Standalone theme switcher. Lives in the AppHeader alongside the auth
 * area, visible whether the user is signed in or anonymous — preferences
 * shouldn't be gated behind login.
 *
 * Single trigger button (current-state icon) → dropdown with Light / Dark
 * / System. Three options instead of a 2-state toggle so the "follow my OS"
 * preference is reachable.
 */
type ThemeValue = 'light' | 'dark' | 'system'

export function ThemeToggle() {
  const theme = useThemeStore((s) => s.theme)
  const setTheme = useThemeStore((s) => s.setTheme)

  return (
    <DropdownMenu>
      {/* 44x44 touch target per WCAG 2.5.5. Visual icon stays at 16px. */}
      <DropdownMenuTrigger
        className="text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:ring-ring focus-visible:ring-offset-background inline-flex h-11 w-11 items-center justify-center rounded-md transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        aria-label="Change theme"
      >
        <CurrentThemeIcon theme={theme} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-36">
        <ThemeOption value="light" current={theme} onSelect={setTheme} icon={Sun} label="Light" />
        <ThemeOption value="dark" current={theme} onSelect={setTheme} icon={Moon} label="Dark" />
        <ThemeOption
          value="system"
          current={theme}
          onSelect={setTheme}
          icon={Laptop}
          label="System"
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function CurrentThemeIcon({ theme }: { theme: ThemeValue }) {
  if (theme === 'dark') return <Moon className="h-4 w-4" />
  if (theme === 'light') return <Sun className="h-4 w-4" />
  return <Laptop className="h-4 w-4" />
}

function ThemeOption({
  value,
  current,
  onSelect,
  icon: Icon,
  label,
}: {
  value: ThemeValue
  current: ThemeValue
  onSelect: (v: ThemeValue) => void
  icon: typeof Sun
  label: string
}) {
  const active = current === value
  return (
    <DropdownMenuItem onSelect={() => onSelect(value)}>
      <Icon className="mr-2 h-4 w-4" />
      <span className="flex-1">{label}</span>
      {active && <Check className="h-4 w-4" />}
    </DropdownMenuItem>
  )
}
