import { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Outlet, redirect } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'

import { AppHeader } from '@/components/layout/app-header'
import { NowPlayingBar } from '@/components/player/now-playing-bar'
import { Toaster } from '@/components/ui/sonner'
import { auth } from '@/lib/auth/api'
import { hasVerifiedPrimaryEmail, isSessionAuthenticated } from '@/lib/auth/hooks'
import { emailKeys, sessionKeys } from '@/lib/query/keys'

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
  // Public, even for unverified users — they should be able to read docs
  // without having to clear the verification gate first.
  '/docs',
]

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
  // Default <title> when a child route doesn't override. Per-route overrides
  // happen via `head: () => ({ meta: [{ title: '...' }] })` in each file route.
  head: () => ({ meta: [{ title: 'react-django-template' }] }),
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

    // Not logged in → not this gate's concern; let the route render and
    // any IsAuthenticated/redirect-to-login handling happens downstream.
    if (!isSessionAuthenticated(session)) return

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

      <AppHeader />

      {/* pb-28 keeps content clear of the fixed now-playing bar. */}
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-5xl px-6 py-8 pb-28">
        <Outlet />
      </main>

      {/* Persistent player + queue — survives navigation; renders only when
          authenticated and something is queued. */}
      <NowPlayingBar />

      {/* Global toast surface (theme-synced, top-right). The wrapper
          component lives at components/ui/sonner.tsx — that's where to
          tune positioning, duration, etc. Use `toast.success/error/...`
          from 'sonner' anywhere to emit. */}
      <Toaster />

      {import.meta.env.DEV && <TanStackRouterDevtools />}
    </div>
  )
}
