import { createRootRoute, Link, Outlet } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'

import { useSession } from '@/lib/auth/hooks'

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  // Fires a GET to /_allauth/browser/v1/auth/session on mount. Two side effects:
  //   1. Django's CsrfViewMiddleware sets the csrftoken cookie, so any later
  //      POST/DELETE has a token to send.
  //   2. We learn the current auth state and cache it under qk.session.
  useSession()

  return (
    <div className="bg-background text-foreground min-h-screen">
      <header className="border-border border-b">
        <nav className="mx-auto flex max-w-5xl items-center gap-6 px-6 py-4">
          <Link to="/" className="font-semibold tracking-tight">
            3d
          </Link>
          <Link
            to="/notes"
            className="text-muted-foreground hover:text-foreground text-sm"
            activeProps={{ className: 'text-foreground font-medium' }}
          >
            Notes
          </Link>
          <div className="ml-auto flex items-center gap-3">
            <Link to="/login" className="text-muted-foreground hover:text-foreground text-sm">
              Log in
            </Link>
            <Link to="/signup" className="text-muted-foreground hover:text-foreground text-sm">
              Sign up
            </Link>
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">
        <Outlet />
      </main>
      {import.meta.env.DEV && <TanStackRouterDevtools />}
    </div>
  )
}
