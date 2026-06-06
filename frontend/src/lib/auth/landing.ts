import { api } from '@/lib/api/client'
import type { PaginatedPlaylistList } from '@/lib/api/models'

/**
 * Where to send a user the instant they finish authenticating. An explicit
 * return path (the auth guard's ?redirect) always wins. Otherwise land on the
 * playlists wall if they have any, else home — the import hub — so a brand-new
 * account isn't dropped on an empty wall.
 *
 * The count is read with a direct request rather than the cached infinite
 * playlists query (whose cache shape differs); it's one cheap call at the login
 * boundary, and it falls back to home if the lookup fails.
 */
export async function resolveLanding(returnTo?: string): Promise<string> {
  if (returnTo) return returnTo
  try {
    const { count } = await api<PaginatedPlaylistList>('/catalog/playlists/?page=1')
    return count > 0 ? '/playlists' : '/'
  } catch {
    return '/'
  }
}
