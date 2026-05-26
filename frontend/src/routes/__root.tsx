import { createRootRoute, Outlet } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'

import { AppHeader } from '@/components/layout/app-header'
import { Toaster } from '@/components/ui/sonner'

export const Route = createRootRoute({
  component: RootLayout,
  // Default <title> when a child route doesn't override. Per-route overrides
  // happen via `head: () => ({ meta: [{ title: '...' }] })` in each file route.
  head: () => ({ meta: [{ title: 'react-django-template' }] }),
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

      <main id="main-content" tabIndex={-1} className="mx-auto max-w-5xl px-6 py-8">
        <Outlet />
      </main>

      {/* Global toast surface (theme-synced, top-right). The wrapper
          component lives at components/ui/sonner.tsx — that's where to
          tune positioning, duration, etc. Use `toast.success/error/...`
          from 'sonner' anywhere to emit. */}
      <Toaster />

      {import.meta.env.DEV && <TanStackRouterDevtools />}
    </div>
  )
}
