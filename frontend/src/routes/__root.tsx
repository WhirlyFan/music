import { createRootRoute, Outlet } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/react-router-devtools'

import { AppHeader } from '@/components/layout/app-header'

export const Route = createRootRoute({
  component: RootLayout,
  // Default <title> when a child route doesn't override. Per-route overrides
  // happen via `head: () => ({ meta: [{ title: '...' }] })` in each file route.
  head: () => ({ meta: [{ title: 'react-django-template' }] }),
})

function RootLayout() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/*
       * Skip-navigation link. Visually hidden until focused — the first Tab
       * press on any page exposes a 'Skip to main content' button that jumps
       * focus past the header. Required by WCAG 2.4.1.
       */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary-foreground focus:shadow-md"
      >
        Skip to main content
      </a>

      <AppHeader />

      <main id="main-content" tabIndex={-1} className="mx-auto max-w-5xl px-6 py-8">
        <Outlet />
      </main>

      {import.meta.env.DEV && <TanStackRouterDevtools />}
    </div>
  )
}
