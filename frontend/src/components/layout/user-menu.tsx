import { useNavigate } from '@tanstack/react-router'
import { LogOut, Settings } from 'lucide-react'

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { UserAvatar } from '@/components/ui/user-avatar'
import { useLogout } from '@/lib/hooks/mutations/auth'

type Props = {
  username: string
}

/**
 * Account menu — avatar (+ username on wider screens) opens a labeled dropdown
 * of account actions (Settings, Log out). Jam + Invite live in the FAB now.
 */
export function UserMenu({ username }: Props) {
  const navigate = useNavigate()
  const logout = useLogout()

  const handleLogout = async () => {
    await logout.mutateAsync()
    navigate({ to: '/login' })
  }

  return (
    <DropdownMenu>
      {/* 44x44 minimum touch target per WCAG 2.5.5 — the trigger area is
          padded; the avatar visual stays at 36px so the design doesn't
          balloon. The pill sits on the page bg so it reads in the corner. */}
      <DropdownMenuTrigger
        className="ring-offset-background focus-visible:ring-ring bg-background/70 border-border/60 flex min-h-11 items-center gap-2 rounded-full border py-1 pr-3 pl-1 shadow-sm backdrop-blur transition-shadow focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        aria-label="Open account menu"
      >
        {/* Person-on-glass avatar, seeded by username (stable across email changes). */}
        <UserAvatar username={username} size="size-9" icon="size-4" />
        {/* Username next to the avatar on medium+ widths so the corner stays
            compact on mobile. */}
        <span className="hidden text-sm font-medium sm:inline">{username}</span>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onSelect={() => navigate({ to: '/settings' })}>
          <Settings className="mr-2 h-4 w-4" />
          Settings
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem onSelect={handleLogout} disabled={logout.isPending}>
          <LogOut className="mr-2 h-4 w-4" />
          {logout.isPending ? 'Logging out…' : 'Log out'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
