import './index.css'

import { QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { RootErrorBoundary } from '@/components/layout/root-error-boundary'
import { OverlayRenderer } from '@/lib/overlay'
import { queryClient } from '@/lib/query/client'
import { applyInitialTheme } from '@/lib/theme/store'

import { routeTree } from './routeTree.gen'

// Apply the persisted theme before React mounts so the page never flashes
// the wrong palette on a hard reload.
applyInitialTheme()

const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  // Wrap navigations (incl. Back/Forward) in the View Transitions API so routes
  // can animate OUT, not just in. We scope the visible effect in index.css: the
  // root swap stays instant (ordinary pages unchanged), and only named regions
  // like the auth card play an open/close — see `::view-transition-*(auth-card)`.
  defaultViewTransition: true,
  context: { queryClient },
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element #root not found in index.html — cannot mount React.')
}

createRoot(rootElement).render(
  <StrictMode>
    <RootErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        {/* Sibling to the router so overlays render above all routes. */}
        <OverlayRenderer />
        {/* Dev-only TanStack Query inspector (cache, fetch states). Tree-shaken
            out of prod builds. Toggle via its own floating button. */}
        {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
      </QueryClientProvider>
    </RootErrorBoundary>
  </StrictMode>,
)
