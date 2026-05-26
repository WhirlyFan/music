import './index.css'

import { QueryClientProvider } from '@tanstack/react-query'
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
      </QueryClientProvider>
    </RootErrorBoundary>
  </StrictMode>,
)
