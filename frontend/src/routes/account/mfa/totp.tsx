import { useForm } from '@tanstack/react-form'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Loader2, ShieldCheck } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { toast } from 'sonner'

import { SettingsPageShell } from '@/components/layout/settings-page-shell'
import { Button } from '@/components/ui/button'
import { FormError } from '@/components/ui/form-error'
import { Input } from '@/components/ui/input'
import { bannerError, fieldErrorMessage, parseAllAuthErrors } from '@/lib/auth/errors'
import { useActivateTotp, useDeactivateTotp, useTotpSetup } from '@/lib/auth/mfa'
import { confirm } from '@/lib/overlay'

export const Route = createFileRoute('/account/mfa/totp')({
  component: TotpEnrollPage,
  head: () => ({ meta: [{ title: 'Enroll TOTP — react-django-template' }] }),
})

// `meta.secret` + `meta.totp_url` arrive when allauth returns HTTP 404 + the
// new-enrollment payload (i.e. user hasn't enrolled yet). When the user IS
// enrolled, allauth returns HTTP 200 + `data` with the existing
// authenticator's metadata (`type`, `created_at`, `last_used_at`).
type TotpSetupMeta = { secret?: string; totp_url?: string }
type TotpExistingData = { type?: string; created_at?: number; last_used_at?: number | null }

function TotpEnrollPage() {
  const navigate = useNavigate()
  const setup = useTotpSetup()
  const deactivate = useDeactivateTotp()

  const enrolled = setup.data?.status === 200
  const existing = (setup.data?.data as TotpExistingData | undefined) ?? null
  const setupMeta = (setup.data?.meta as TotpSetupMeta | undefined) ?? null
  const secret = setupMeta?.secret
  const otpUrl = setupMeta?.totp_url

  return (
    <SettingsPageShell
      breadcrumbs={[
        { label: 'Settings', to: '/settings' },
        { label: 'Multi-factor authentication', to: '/account/mfa' },
        { label: 'Authenticator app' },
      ]}
      title="Authenticator app"
    >
      {setup.isLoading || !setup.data ? (
        <div className="flex items-center gap-2 text-sm" aria-live="polite">
          <Loader2 className="text-muted-foreground h-4 w-4 animate-spin" aria-hidden="true" />
          <span className="text-muted-foreground">Loading…</span>
        </div>
      ) : enrolled ? (
        <EnrolledState
          createdAt={existing?.created_at}
          lastUsedAt={existing?.last_used_at}
          onRemove={async () => {
            if (deactivate.isPending) return
            // Destructive + auth-weakening — confirm explicitly. Same
            // overlay pattern as the /account/mfa overview row.
            const ok = await confirm({
              title: 'Remove authenticator app?',
              description:
                "You'll lose your second factor. Recovery codes will also be invalidated. You can always re-enroll later.",
              confirmLabel: 'Remove',
              destructive: true,
            })
            if (!ok) return
            const res = await deactivate.mutateAsync()
            if (res.status === 200) {
              toast.success('Authenticator removed.')
              navigate({ to: '/account/mfa' })
            } else {
              const msg = bannerError(res, 'Could not remove authenticator. Try again.')
              if (msg) toast.error(msg)
            }
          }}
          removing={deactivate.isPending}
          onDone={() => navigate({ to: '/account/mfa' })}
        />
      ) : secret && otpUrl ? (
        <EnrollState
          secret={secret}
          otpUrl={otpUrl}
          onActivated={() => navigate({ to: '/account/mfa' })}
        />
      ) : (
        <p role="alert" className="text-destructive text-sm">
          Couldn’t start enrollment. Refresh the page and try again.
        </p>
      )}
    </SettingsPageShell>
  )
}

function EnrolledState({
  createdAt,
  lastUsedAt,
  onRemove,
  removing,
  onDone,
}: {
  createdAt?: number
  lastUsedAt?: number | null
  onRemove: () => void
  removing: boolean
  onDone: () => void
}) {
  const fmt = (epochSec?: number | null) =>
    epochSec ? new Date(epochSec * 1000).toLocaleString() : '—'
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Authenticator app enrolled</h1>
        <p className="text-muted-foreground text-sm">
          You have a TOTP authenticator set up for this account.
        </p>
      </div>

      <dl className="bg-card divide-border grid grid-cols-1 divide-y rounded-md border text-sm">
        <div className="flex items-center justify-between p-4">
          <dt className="text-muted-foreground">Status</dt>
          <dd className="text-success inline-flex items-center gap-1">
            <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Enrolled
          </dd>
        </div>
        <div className="flex items-center justify-between p-4">
          <dt className="text-muted-foreground">Enrolled at</dt>
          <dd>{fmt(createdAt)}</dd>
        </div>
        <div className="flex items-center justify-between p-4">
          <dt className="text-muted-foreground">Last used</dt>
          <dd>{fmt(lastUsedAt)}</dd>
        </div>
      </dl>

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button variant="ghost" onClick={onDone}>
          Done
        </Button>
        <Button
          variant="destructive"
          onClick={onRemove}
          disabled={removing}
          aria-busy={removing || undefined}
        >
          {removing ? 'Removing…' : 'Remove authenticator'}
        </Button>
      </div>
    </div>
  )
}

function EnrollState({
  secret,
  otpUrl,
  onActivated,
}: {
  secret: string
  otpUrl: string
  onActivated: () => void
}) {
  const activate = useActivateTotp()
  const form = useForm({
    defaultValues: { code: '' },
    onSubmit: async ({ value }) => {
      if (activate.isPending) return
      const result = await activate.mutateAsync(value.code.trim())
      if (result.status === 200) {
        toast.success('Authenticator enrolled.')
        onActivated()
      } else {
        const msg = bannerError(result, 'That code didn’t match — try again.')
        if (msg) toast.error(msg)
      }
    },
  })
  const parsed = parseAllAuthErrors(activate.data)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Enroll authenticator app</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Scan the QR with Google Authenticator, 1Password, Authy, or any TOTP app — or paste the
          secret manually — then enter the 6-digit code to confirm.
        </p>
      </div>

      <div className="bg-card flex flex-col items-center gap-4 rounded-md border p-6 sm:flex-row sm:items-start">
        {/* White background so dark mode renders a scannable QR — high contrast
            against a light bg per the QR spec. */}
        <div className="rounded-md bg-white p-3">
          <QRCodeSVG value={otpUrl} size={180} aria-label="TOTP enrollment QR code" />
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">Manual entry secret</p>
          <code className="bg-muted block rounded px-2 py-1 font-mono text-xs break-all">
            {secret}
          </code>
          <p className="text-muted-foreground text-xs">
            Most apps accept the QR. Use the manual secret if you’re enrolling on a different
            device.
          </p>
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          form.handleSubmit()
        }}
        className="space-y-4"
      >
        <form.Field name="code">
          {(field) => {
            const fieldErr =
              fieldErrorMessage(field.state.meta.errors[0]) ?? parsed.byField['code']?.[0]
            return (
              <div className="space-y-1">
                <label htmlFor={field.name} className="text-sm font-medium">
                  6-digit code
                </label>
                <Input
                  id={field.name}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  required
                  aria-required="true"
                  aria-invalid={fieldErr ? true : undefined}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                <FormError id={`${field.name}-error`} message={fieldErr} />
              </div>
            )
          }}
        </form.Field>

        <Button
          type="submit"
          disabled={activate.isPending}
          aria-busy={activate.isPending || undefined}
          className="w-full"
        >
          {activate.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              Verifying…
            </>
          ) : (
            'Confirm and enroll'
          )}
        </Button>
      </form>
    </div>
  )
}
