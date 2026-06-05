import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { useEffect } from 'react'
import { toast } from 'sonner'

import { sessionKeys } from '@/lib/hooks/keys'

/**
 * Landing spot after a social (Google) redirect. allauth sets the session cookie
 * on success, or appends `?error=…` on failure. Either way we leave immediately:
 *   - success → refresh the session cache, go home (or `next` for connect-from-settings)
 *   - error   → a STICKY toast (duration: Infinity; the global Toaster's closeButton
 *               lets the user dismiss it) so the reason — e.g. "not invited" — survives
 *               the redirect and is readable, then back to /login (or /settings).
 * A stable toast id dedupes React's dev double-effect. Kept as its own route so none
 * of this leaks into the password-login flow.
 */
export const Route = createFileRoute('/auth/callback')({
  // `next` lets the connect-from-settings flow return to where it started. Only a
  // same-origin internal path is honored (single leading '/') — no open redirect.
  validateSearch: (search: Record<string, unknown>): { error?: string; from?: string } => {
    const f = search.from
    return {
      error: typeof search.error === 'string' ? search.error : undefined,
      from: typeof f === 'string' && f.startsWith('/') && !f.startsWith('//') ? f : undefined,
    }
  },
  component: SocialCallback,
})

const ERROR_COPY: Record<string, string> = {
  signup_closed: 'That Google account isn’t invited yet — ask a member to invite your email.',
  permission_denied: 'Google sign-in was cancelled.',
  account_already_connected: 'That Google account is already linked to another user.',
}

function SocialCallback() {
  const { error, from } = Route.useSearch()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  useEffect(() => {
    if (error) {
      toast.error(ERROR_COPY[error] ?? 'Google sign-in didn’t complete — please try again.', {
        id: 'social-login-error',
        duration: Infinity, // sticky; the Toaster's closeButton dismisses it
      })
      // Return to whichever page launched the flow (login / signup / settings).
      void navigate({ to: from ?? '/login', replace: true })
      return
    }
    // Success: the session cookie is set; drop the stale cache and continue on.
    // A successful *connect* (from /settings) returns there; a login/signup goes home.
    void queryClient.invalidateQueries({ queryKey: sessionKeys.all() })
    void navigate({ to: from === '/settings' ? '/settings' : '/', replace: true })
  }, [error, from, navigate, queryClient])

  return (
    <div className="text-muted-foreground grid min-h-[60vh] place-items-center gap-3 text-sm">
      <Loader2 className="text-primary size-6 animate-spin" aria-hidden="true" />
      Signing you in…
    </div>
  )
}
