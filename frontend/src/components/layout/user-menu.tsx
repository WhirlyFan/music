import { useNavigate } from '@tanstack/react-router'
import { LogOut, Settings } from 'lucide-react'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { avatarInitials, dicebearAvatarUrl } from '@/lib/auth/avatar'
import { useLogout } from '@/lib/hooks/mutations/auth'

type Props = {
  username: string
  email: string
  firstName?: string
  lastName?: string
}

/**
 * Account dropdown — avatar trigger + user info + account actions.
 *
 * Theme switching is *not* here: it lives in ThemeToggle in the header so
 * it's reachable when logged out too. This menu is strictly for user-scoped
 * actions (settings, log out, future profile/billing/etc.).
 */
export function UserMenu({ username, email, firstName, lastName }: Props) {
  const navigate = useNavigate()
  const logout = useLogout()

  // Pick the best human label: "First Last" if both set, else username.
  const fullName = `${firstName ?? ''} ${lastName ?? ''}`.trim()
  const displayName = fullName || username

  const handleLogout = async () => {
    await logout.mutateAsync()
    navigate({ to: '/login' })
  }

  return (
    <DropdownMenu>
      {/* 44x44 minimum touch target per WCAG 2.5.5 — the trigger area is
          padded; the avatar visual stays at 36px so the design doesn't
          balloon. */}
      <DropdownMenuTrigger
        className="ring-offset-background focus-visible:ring-ring flex min-h-11 items-center gap-2 rounded-full px-1 py-1 transition-shadow focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        aria-label="Open account menu"
      >
        <Avatar className="h-9 w-9">
          {/* DiceBear avatar seeded by username (stable across email changes). */}
          <AvatarImage src={dicebearAvatarUrl(username)} alt="" />
          <AvatarFallback>{avatarInitials(displayName)}</AvatarFallback>
        </Avatar>
        {/* Username next to the avatar on medium+ widths so the header stays
            compact on mobile. The dropdown still has the full info. */}
        <span className="hidden text-sm font-medium sm:inline">{username}</span>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="truncate text-sm font-medium">{displayName}</span>
          <span className="text-muted-foreground truncate text-xs font-normal">@{username}</span>
          <span className="text-muted-foreground truncate text-xs font-normal">{email}</span>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

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
