import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft, RefreshCw } from 'lucide-react'

import { Button, buttonVariants } from '@/components/ui/button'
import { useGenerateRecoveryCodes, useRecoveryCodes } from '@/lib/auth/mfa'

export const Route = createFileRoute('/account/2fa/recovery-codes')({
  component: RecoveryCodesPage,
  head: () => ({ meta: [{ title: 'Recovery codes — react-django-template' }] }),
})

type RecoveryCodeData = {
  unused_codes?: string[]
  total_code_count?: number
  unused_code_count?: number
}

function RecoveryCodesPage() {
  const list = useRecoveryCodes()
  const regenerate = useGenerateRecoveryCodes()

  const codesData = (list.data?.data as RecoveryCodeData | undefined) ?? {}
  const unused = codesData.unused_codes ?? []

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <Link
        to="/account/2fa"
        className={buttonVariants({ variant: 'ghost', size: 'sm' }) + ' -ml-3'}
      >
        <ArrowLeft className="mr-1 h-4 w-4" aria-hidden="true" />
        Back to two-factor settings
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Recovery codes</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Single-use backup codes for when you don’t have your authenticator. Each works exactly
          once. Store them somewhere safe.
        </p>
      </div>

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
          <div className="bg-card grid grid-cols-2 gap-2 rounded-md border p-4 font-mono text-sm">
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
    </div>
  )
}
