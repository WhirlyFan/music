import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { useEffect } from 'react'
import { toast } from 'sonner'

import { sessionKeys } from '@/lib/hooks/keys'

/**
 * Landing spot after a social (Google) redirect. allauth has already set — or
 * not set — the session cookie by the time we get here; it appends `?error=…`
 * on failure. We don't render anything meaningful: on success we refresh the
 * session cache and send the user home (the root guard takes over); on error we
 * toast and bounce to /login. Kept as its own route so none of this leaks into
 * the password-login flow.
 */
export const Route = createFileRoute('/auth/callback')({
  // `next` lets the connect-from-settings flow return to where it started. Only a
  // same-origin internal path is honored (single leading '/') — no open redirect.
  validateSearch: (search: Record<string, unknown>): { error?: string; next?: string } => {
    const n = search.next
    return {
      error: typeof search.error === 'string' ? search.error : undefined,
      next: typeof n === 'string' && n.startsWith('/') && !n.startsWith('//') ? n : undefined,
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
  const { error, next } = Route.useSearch()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  useEffect(() => {
    if (error) {
      toast.error(ERROR_COPY[error] ?? 'Google sign-in didn’t complete — please try again.')
      // Back to where they came from (settings, for a connect attempt) or /login.
      void navigate({ to: next ?? '/login', replace: true })
      return
    }
    // Success: the session cookie is set; drop the stale cache and continue on.
    void queryClient.invalidateQueries({ queryKey: sessionKeys.all() })
    void navigate({ to: next ?? '/', replace: true })
  }, [error, next, navigate, queryClient])

  return (
    <div className="text-muted-foreground grid min-h-[50vh] place-items-center gap-2 text-sm">
      <Loader2 className="size-5 animate-spin" aria-hidden="true" />
      Signing you in…
    </div>
  )
}
