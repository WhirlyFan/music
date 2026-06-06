import { Link } from '@tanstack/react-router'

import { Button } from '@/components/ui/button'
import { useInfinitePlaylists } from '@/lib/hooks/queries/catalog'

/**
 * Minimal floating top-left nav — the only chrome that remains now that the app
 * is just Home (the import/search hub) and the playlists wall. The "music"
 * wordmark goes Home; the Playlists pill appears only once you actually have
 * playlists (no dead-end for new users). A small backdrop pill keeps it legible
 * over the cover wall it floats above. Mounted only when authenticated (the
 * playlists count query is gated behind that mount).
 */
export function TopNav() {
  // Shares the playlists list cache key with the wall, so this both gates the
  // Playlists pill and warms that page's first request.
  const { data } = useInfinitePlaylists('')
  const hasPlaylists = (data?.pages?.[0]?.count ?? 0) > 0

  return (
    <nav className="tron-trace border-border/60 bg-background/70 fixed top-3 left-4 z-40 flex items-center gap-1 rounded-full border p-1 shadow-sm backdrop-blur">
      <Button
        asChild
        variant="ghost"
        size="sm"
        className="rounded-full px-3 font-semibold tracking-tight"
      >
        <Link to="/">music</Link>
      </Button>
      {hasPlaylists && (
        <Button asChild variant="ghost" size="sm" className="rounded-full">
          <Link to="/playlists" activeProps={{ className: 'bg-secondary text-foreground' }}>
            playlists
          </Link>
        </Button>
      )}
    </nav>
  )
}
