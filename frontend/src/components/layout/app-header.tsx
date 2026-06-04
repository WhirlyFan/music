import { Link } from '@tanstack/react-router'

import { ThemeToggle } from '@/components/layout/theme-toggle'
import { UserMenu } from '@/components/layout/user-menu'
import { useSession } from '@/lib/auth/hooks'

type SessionUser = {
  email?: string
  username?: string
  first_name?: string
  last_name?: string
}
type SessionData = { user?: SessionUser }

/**
 * Single top-level app header. Brand on the left, nav in the middle,
 * auth area on the right (avatar + dropdown when signed in, login/signup
 * links when anonymous).
 *
 * Per the composition skill: configuration API for the 80% case — we have
 * exactly one header. If/when we add admin or marketing headers, refactor
 * to a compound API (<AppHeader.Brand>/<AppHeader.Nav>/<AppHeader.Auth>).
 */
export function AppHeader() {
  const { data } = useSession()
  const isAuthed = data?.status === 200
  const user = (data?.data as SessionData | undefined)?.user

  return (
    <header className="border-border bg-card text-card-foreground border-b">
      <nav className="mx-auto flex h-14 max-w-5xl items-center gap-6 px-6">
        <Link to="/" className="font-semibold tracking-tight">
          music
        </Link>

        {isAuthed && (
          <Link
            to="/notes"
            className="text-muted-foreground hover:text-foreground text-sm"
            activeProps={{ className: 'text-foreground font-medium' }}
          >
            Notes
          </Link>
        )}

        {isAuthed && (
          <Link
            to="/playlists"
            className="text-muted-foreground hover:text-foreground text-sm"
            activeProps={{ className: 'text-foreground font-medium' }}
          >
            Playlists
          </Link>
        )}

        {isAuthed && (
          <Link
            to="/docs"
            className="text-muted-foreground hover:text-foreground text-sm"
            activeProps={{ className: 'text-foreground font-medium' }}
          >
            Docs
          </Link>
        )}

        <div className="ml-auto flex items-center gap-2">
          {/* Theme toggle lives outside the auth-state branch so it's always
              reachable. Preferences aren't user-gated. */}
          <ThemeToggle />

          {isAuthed && user?.username && user.email ? (
            <UserMenu
              username={user.username}
              email={user.email}
              firstName={user.first_name}
              lastName={user.last_name}
            />
          ) : (
            <div className="flex items-center gap-3 pl-1">
              <Link to="/login" className="text-muted-foreground hover:text-foreground text-sm">
                Log in
              </Link>
              <Link to="/signup" className="text-muted-foreground hover:text-foreground text-sm">
                Sign up
              </Link>
            </div>
          )}
        </div>
      </nav>
    </header>
  )
}
