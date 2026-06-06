import { useNavigate } from '@tanstack/react-router'
import { LogOut, Radio, Settings } from 'lucide-react'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { avatarInitials, dicebearAvatarUrl } from '@/lib/auth/avatar'
import { useLogout } from '@/lib/hooks/mutations/auth'
import { usePlayerUiStore } from '@/lib/stores/player-ui'

type Props = {
  username: string
  firstName?: string
  lastName?: string
}

/**
 * Account menu — avatar (+ username on wider screens) opens a labeled dropdown
 * of account actions (Settings, Jam, Log out). The Jam item opens the global jam
 * modal (start/join/manage); inviting a friend lives in the FAB now.
 */
export function UserMenu({ username, firstName, lastName }: Props) {
  const navigate = useNavigate()
  const logout = useLogout()
  const setJamOpen = usePlayerUiStore((s) => s.setJamOpen)

  const handleLogout = async () => {
    await logout.mutateAsync()
    navigate({ to: '/login' })
  }

  const fullName = `${firstName ?? ''} ${lastName ?? ''}`.trim()
  const initials = avatarInitials(fullName || username)

  return (
    <DropdownMenu>
      {/* 44x44 minimum touch target per WCAG 2.5.5 — the trigger area is
          padded; the avatar visual stays at 36px so the design doesn't
          balloon. The pill sits on the page bg so it reads in the corner. */}
      <DropdownMenuTrigger
        className="ring-offset-background focus-visible:ring-ring bg-background/70 border-border/60 flex min-h-11 items-center gap-2 rounded-full border py-1 pr-3 pl-1 shadow-sm backdrop-blur transition-shadow focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        aria-label="Open account menu"
      >
        <Avatar className="h-9 w-9">
          {/* DiceBear avatar seeded by username (stable across email changes). */}
          <AvatarImage src={dicebearAvatarUrl(username)} alt="" />
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
        {/* Username next to the avatar on medium+ widths so the corner stays
            compact on mobile. */}
        <span className="hidden text-sm font-medium sm:inline">{username}</span>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onSelect={() => navigate({ to: '/settings' })}>
          <Settings className="mr-2 h-4 w-4" />
          Settings
        </DropdownMenuItem>

        <DropdownMenuItem onSelect={() => setJamOpen(true)}>
          <Radio className="mr-2 h-4 w-4" />
          Jam
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
