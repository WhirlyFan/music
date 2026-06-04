/**
 * Centralized TanStack Query keys.
 *
 * One namespace per domain (`sessionKeys`, `noteKeys`, …). Each namespace
 * has an `all()` entry returning the broadest prefix, plus specific entries
 * scoped beneath it. Mutations invalidate the narrowest matching prefix —
 * broad invalidation goes through `all()`, surgical invalidation through
 * `list()` / `detail()` / etc.
 *
 * Every entry is a function (even no-arg ones) for a uniform call shape
 * at the use site: `useQuery({ queryKey: noteKeys.list() })`.
 *
 * Pattern mirrors the reference at
 * ~/usul-policy-research-app/frontend/lib/hooks/queries/query-keys.ts.
 */

export const sessionKeys = {
  all: () => ['session'] as const,
}

/**
 * User's email addresses (verified flag + primary flag). Source of truth
 * for the verified-email gate — allauth's session endpoint doesn't expose
 * verification status, so we read from `/account/email` instead.
 */
export const emailKeys = {
  all: () => ['emails'] as const,
  list: () => ['emails', 'list'] as const,
}

export const noteKeys = {
  all: () => ['notes'] as const,
  list: () => ['notes', 'list'] as const,
  detail: (id: number) => ['notes', 'detail', id] as const,
}

export const playlistKeys = {
  all: () => ['playlists'] as const,
  list: () => ['playlists', 'list'] as const,
  detail: (id: string) => ['playlists', 'detail', id] as const,
  // Paginated tracks of one playlist (useInfiniteQuery). Nested under detail so
  // invalidating the playlist refreshes both its metadata and its track pages.
  tracks: (id: string) => ['playlists', 'detail', id, 'tracks'] as const,
}

/**
 * The caller's listening room (room-of-one): now-playing + persisted queue.
 * `me()` is the single source of truth — every queue/playback mutation
 * invalidates it so the player + queue panel re-render from the server.
 */
export const roomKeys = {
  all: () => ['room'] as const,
  me: () => ['room', 'me'] as const,
}

/**
 * MFA surface: authenticator list + per-method enrollment data.
 *
 * The cascade is deliberate — `mfaKeys.all()` is the parent prefix used by
 * mutation `onSuccess` to invalidate the whole surface in one call. Individual
 * hooks read the specific entries below.
 */
export const mfaKeys = {
  all: () => ['mfa'] as const,
  authenticators: () => ['mfa', 'authenticators'] as const,
  totpSetup: () => ['mfa', 'totp-setup'] as const,
  recoveryCodes: () => ['mfa', 'recovery-codes'] as const,
}
