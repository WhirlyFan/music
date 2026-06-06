import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { RefreshCw } from 'lucide-react'

import { ReauthenticateStep, requiresReauth } from '@/components/auth/reauthenticate-step'
import { settingsCard, SettingsPageShell } from '@/components/layout/settings-page-shell'
import { Button } from '@/components/ui/button'
import { useGenerateRecoveryCodes, useRecoveryCodes } from '@/lib/auth/mfa'
import { mfaKeys } from '@/lib/hooks/keys'

export const Route = createFileRoute('/account/mfa/recovery-codes')({
  component: RecoveryCodesPage,
  head: () => ({ meta: [{ title: 'Recovery codes — music' }] }),
})

type RecoveryCodeData = {
  unused_codes?: string[]
  total_code_count?: number
  unused_code_count?: number
}

function RecoveryCodesPage() {
  const qc = useQueryClient()
  const list = useRecoveryCodes()
  const regenerate = useGenerateRecoveryCodes()

  const breadcrumbs = [
    { label: 'Settings', to: '/settings' },
    { label: 'Multi-factor authentication', to: '/account/mfa' },
    { label: 'Recovery codes' },
  ]

  // allauth gates the recovery-codes read as a sensitive operation: when
  // the session isn't fresh it returns 401 + a `reauthenticate` flow. Same
  // pattern as the passkey enrollment surface — surface the reauth card,
  // then invalidate the recovery-codes query to retry on success.
  if (requiresReauth(list.data)) {
    return (
      <SettingsPageShell
        breadcrumbs={breadcrumbs}
        title="Recovery codes"
        description="Single-use backup codes for when you don’t have your authenticator. Each works exactly once. Store them somewhere safe."
      >
        <ReauthenticateStep
          description="Viewing recovery codes is a sensitive change — re-enter your password to continue."
          onConfirmed={() => qc.invalidateQueries({ queryKey: mfaKeys.recoveryCodes() })}
        />
      </SettingsPageShell>
    )
  }

  const codesData = (list.data?.data as RecoveryCodeData | undefined) ?? {}
  const unused = codesData.unused_codes ?? []

  return (
    <SettingsPageShell
      breadcrumbs={breadcrumbs}
      title="Recovery codes"
      description="Single-use backup codes for when you don’t have your authenticator. Each works exactly once. Store them somewhere safe."
    >
      {list.isLoading ? (
        <p className="text-muted-foreground text-sm" aria-live="polite">
          Loading…
        </p>
      ) : list.isError || list.data?.status === 404 ? (
        <p className="text-muted-foreground text-sm">
          No recovery codes yet. Enroll TOTP first — codes are minted automatically alongside it.
        </p>
      ) : (
        <>
          <div
            className={`${settingsCard} grid grid-cols-1 gap-2 p-4 font-mono text-sm sm:grid-cols-2`}
          >
            {unused.map((code) => (
              <code key={code} className="bg-muted rounded px-2 py-1">
                {code}
              </code>
            ))}
          </div>

          <div className="space-y-3">
            <p className="text-muted-foreground text-xs">
              {codesData.unused_code_count ?? unused.length} of {codesData.total_code_count ?? '—'}{' '}
              codes remain.
            </p>
            <Button
              variant="outline"
              onClick={() => regenerate.mutate()}
              disabled={regenerate.isPending}
              aria-busy={regenerate.isPending || undefined}
            >
              <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
              {regenerate.isPending ? 'Generating…' : 'Generate a new set'}
            </Button>
            <p className="text-muted-foreground text-xs">
              Generating new codes invalidates the existing set.
            </p>
          </div>
        </>
      )}
    </SettingsPageShell>
  )
}
