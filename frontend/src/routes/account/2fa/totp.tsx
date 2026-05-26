import { useForm } from '@tanstack/react-form'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'

import { Button, buttonVariants } from '@/components/ui/button'
import { FormError } from '@/components/ui/form-error'
import { Input } from '@/components/ui/input'
import { friendlyAuthError, parseAllAuthErrors } from '@/lib/auth/errors'
import { useActivateTotp, useTotpSetup } from '@/lib/auth/mfa'

export const Route = createFileRoute('/account/2fa/totp')({
  component: TotpEnrollPage,
  head: () => ({ meta: [{ title: 'Enroll TOTP — react-django-template' }] }),
})

type TotpSetupData = {
  secret?: string
  totp_url?: string
}

function TotpEnrollPage() {
  const navigate = useNavigate()
  const setup = useTotpSetup()
  const activate = useActivateTotp()

  const setupData = setup.data?.data as TotpSetupData | undefined
  const secret = setupData?.secret
  const otpUrl = setupData?.totp_url

  const form = useForm({
    defaultValues: { code: '' },
    onSubmit: async ({ value }) => {
      const result = await activate.mutateAsync(value.code.trim())
      if (result.status === 200) navigate({ to: '/account/2fa' })
    },
  })

  const parsed = parseAllAuthErrors(activate.data)
  const error =
    activate.data && activate.data.status !== 200
      ? friendlyAuthError(parsed, 'That code didn’t match — try again.')
      : null

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
        <h1 className="text-2xl font-semibold tracking-tight">Enroll authenticator app</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Scan the QR with Google Authenticator, 1Password, Authy, or any TOTP app — or paste the
          secret manually — then enter the 6-digit code to confirm.
        </p>
      </div>

      {setup.isLoading ? (
        <p className="text-muted-foreground text-sm" aria-live="polite">
          Preparing your authenticator…
        </p>
      ) : setup.isError || !otpUrl || !secret ? (
        <p role="alert" className="text-destructive text-sm">
          Couldn’t start enrollment. Refresh the page and try again.
        </p>
      ) : (
        <>
          <div className="bg-card flex flex-col items-center gap-4 rounded-md border p-6 sm:flex-row sm:items-start">
            {/* White background so dark mode renders a scannable QR (QR codes
                need high contrast against a light bg per the spec). */}
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
            aria-describedby={error ? 'totp-form-error' : undefined}
            className="space-y-4"
          >
            <form.Field name="code">
              {(field) => {
                const fieldErr = parsed.byField['code']?.[0]
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
              aria-busy={activate.isPending || undefined}
              aria-disabled={activate.isPending || undefined}
              className={`w-full ${activate.isPending ? 'pointer-events-none opacity-60' : ''}`}
            >
              {activate.isPending ? 'Verifying…' : 'Confirm and enroll'}
            </Button>

            <FormError id="totp-form-error" message={error} />
          </form>
        </>
      )}
    </div>
  )
}
