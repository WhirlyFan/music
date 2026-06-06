import { QueryClient } from '@tanstack/react-query'
import {
  createRootRouteWithContext,
  Outlet,
  redirect,
  retainSearchParams,
  useNavigate,
} from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'
import { useEffect, useRef } from 'react'
import { toast } from 'sonner'

import { GlobalSearchPill } from '@/components/layout/global-search-pill'
import { QuickActionsFab } from '@/components/layout/quick-actions-fab'
import { ThemeToggle } from '@/components/layout/theme-toggle'
import { TopNav } from '@/components/layout/top-nav'
import { UserMenu } from '@/components/layout/user-menu'
import { NowPlayingBar } from '@/components/player/now-playing-bar'
import { Toaster } from '@/components/ui/sonner'
import { auth } from '@/lib/auth/api'
import { hasVerifiedPrimaryEmail, isSessionAuthenticated } from '@/lib/auth/guards'
import { useJoinRoom } from '@/lib/hooks/mutations/rooms'
import { emailKeys, sessionKeys } from '@/lib/hooks/keys'
import { useSession } from '@/lib/hooks/queries/auth'

type SessionUser = { email?: string; username?: string; first_name?: string; last_name?: string }
type SessionData = { user?: SessionUser }

// Paths the verified-email guard MUST let through, even when the session is
// authenticated-but-unverified. Mirrors the backend's
// _VERIFIED_EMAIL_EXEMPT_PREFIXES in apps/core/middleware.py — keep them in
// sync. Without these, a freshly-signed-up user would be redirect-looped
// on the very page they need to reach to fix the situation.
const VERIFY_EXEMPT_PREFIXES = [
  '/account/verify-email',
  '/account/logout',
  '/login',
  '/signup',
  '/auth/callback',
]

// Routes a logged-OUT user is allowed to visit. Everything else redirects to
// /login (with the attempted path as ?redirect). Includes the password-reset +
// email-verification flows, which a logged-out user must reach (they arrive via
// an emailed link).
const PUBLIC_PREFIXES = [
  '/login',
  '/signup',
  '/account/logout',
  '/account/verify-email',
  '/account/password/forgot',
  '/account/password/reset',
  // Social-login landing: it finalizes the session (or shows the error) itself,
  // so the guard must not bounce it to /login before its component runs.
  '/auth/callback',
]
const isPublicPath = (path: string) =>
  path === '/' || PUBLIC_PREFIXES.some((p) => path.startsWith(p))

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
  // Default <title> when a child route doesn't override. Per-route overrides
  // happen via `head: () => ({ meta: [{ title: '...' }] })` in each file route.
  head: () => ({ meta: [{ title: 'music' }] }),
  // Player view state lives in the URL (see lib/player-url-state.ts). Declaring
  // the flags here makes them type-safe + lets the router own them; retaining them
  // keeps the now-playing/queue views open across navigation (child routes still
  // own their own params, e.g. /login's ?redirect).
  validateSearch: (
    search: Record<string, unknown>,
  ): { nowPlaying?: boolean; queue?: boolean; jam?: string } => ({
    nowPlaying: search.nowPlaying === true || search.nowPlaying === 'true' ? true : undefined,
    queue: search.queue === true || search.queue === 'true' ? true : undefined,
    // Shareable jam link (/?jam=CODE) — consumed + cleared by RootLayout.
    jam: typeof search.jam === 'string' && search.jam ? search.jam : undefined,
  }),
  search: { middlewares: [retainSearchParams(['nowPlaying', 'queue'])] },
  // Verified-email gate. Runs before every navigation; checks the session
  // (cheap, cached) for authentication, then the email list for verification.
  // allauth's session response doesn't expose `has_verified_email`, so we
  // fall back to the email list endpoint — same source of truth as the
  // backend's RequireVerifiedEmailMiddleware
  // (`EmailAddress.objects.filter(user=user, verified=True).exists()`).
  //
  // Both queries use 5min staleTime + are reset by login/signup/logout/verify
  // mutations, so a navigation usually pays zero network cost.
  beforeLoad: async ({ context, location }) => {
    const path = location.pathname
    if (VERIFY_EXEMPT_PREFIXES.some((p) => path.startsWith(p))) return

    const session = await context.queryClient.fetchQuery({
      queryKey: sessionKeys.all(),
      queryFn: () => auth.session(),
      staleTime: 5 * 60 * 1000,
    })

    // Not logged in → only public routes are allowed; anything else goes to
    // /login, carrying where they were headed so we can return them post-login.
    if (!isSessionAuthenticated(session)) {
      if (!isPublicPath(path)) throw redirect({ to: '/login', search: { redirect: path } })
      return
    }

    const emails = await context.queryClient.fetchQuery({
      queryKey: emailKeys.list(),
      queryFn: () => auth.listEmails(),
      staleTime: 5 * 60 * 1000,
    })

    if (!hasVerifiedPrimaryEmail(emails)) {
      throw redirect({ to: '/account/verify-email' })
    }
  },
})

function RootLayout() {
  const { data: session } = useSession()
  const authed = isSessionAuthenticated(session)
  const user = (session?.data as SessionData | undefined)?.user

  // Shareable jam link (/?jam=CODE): once authed, join that jam then strip the
  // param. join is idempotent, and the ref guards against re-firing on re-render.
  const { jam } = Route.useSearch()
  const navigate = useNavigate()
  const joinRoom = useJoinRoom()
  const joinedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!authed || !jam || joinedFor.current === jam) return
    joinedFor.current = jam
    joinRoom.mutate(jam, {
      onError: () => toast.error('That jam code didn’t work — it may have ended.'),
    })
    void navigate({ to: '.', search: (prev) => ({ ...prev, jam: undefined }), replace: true })
  }, [authed, jam, joinRoom, navigate])

  return (
    <div className="bg-background text-foreground min-h-screen">
      {/*
       * Skip-navigation link. Visually hidden until focused — the first Tab
       * press on any page exposes a 'Skip to main content' button that jumps
       * focus past the header. Required by WCAG 2.4.1.
       */}
      <a
        href="#main-content"
        className="focus:bg-primary focus:text-primary-foreground sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-50 focus:rounded-md focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:shadow-md"
      >
        Skip to main content
      </a>

      {/* Global toast surface (theme-synced, top-right). Mounted BEFORE <Outlet/>
          so its subscriber is listening before any route's mount effect fires —
          otherwise a toast emitted on a fresh page load (e.g. the social-login
          callback) is dropped because no Toaster was subscribed yet. The wrapper
          lives at components/ui/sonner.tsx. Use `toast.*` from 'sonner' anywhere. */}
      <Toaster />

      {/* The top bar is gone (only Home + Playlists remain). Floating chrome
          instead: brand + Playlists top-left (authed), account/theme top-right. */}
      {authed && <TopNav />}
      <div className="fixed top-3 right-4 z-40">
        {user?.username && user.email ? (
          <UserMenu
            username={user.username}
            firstName={user.first_name}
            lastName={user.last_name}
          />
        ) : (
          // Logged out: theme stays globally reachable here (authed users get it
          // inside the gooey FAB instead).
          <ThemeToggle />
        )}
      </div>

      {/* pt-16 clears the floating top chrome; pb-28 clears the fixed player. */}
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-5xl px-4 pt-16 pb-28 sm:px-6">
        <Outlet />
      </main>

      {/* Persistent player + queue — survives navigation; renders only when
          authenticated and something is queued. */}
      <NowPlayingBar />

      {/* One persistent search pill for the playlists routes (no per-page remount
          flash); it reads the route to know what it searches. */}
      <GlobalSearchPill />

      {/* Global bottom-right quick-actions (gooey FAB). */}
      <QuickActionsFab />

      {import.meta.env.DEV && <TanStackRouterDevtools />}
    </div>
  )
}
