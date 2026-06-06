import { useForm } from '@tanstack/react-form'
import { createFileRoute } from '@tanstack/react-router'
import { Loader2, MailCheck } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'

import { settingsCard, SettingsPageShell } from '@/components/layout/settings-page-shell'
import { Button } from '@/components/ui/button'
import { FormError } from '@/components/ui/form-error'
import { Input } from '@/components/ui/input'
import { bannerError, fieldErrorMessage, parseAllAuthErrors } from '@/lib/auth/errors'
import { type EmailAddress } from '@/lib/auth/guards'
import { useChangeEmail } from '@/lib/hooks/mutations/auth'
import { useEmails } from '@/lib/hooks/queries/auth'

export const Route = createFileRoute('/account/email')({
  component: ChangeEmailPage,
  head: () => ({ meta: [{ title: 'Change email — music' }] }),
})

const schema = z.object({ email: z.string().email('Enter a valid email address') })

function ChangeEmailPage() {
  const emails = useEmails()
  const change = useChangeEmail()

  const list = (emails.data?.data as EmailAddress[] | undefined) ?? []
  const primary = list.find((e) => e.primary)
  // With ACCOUNT_CHANGE_EMAIL, a requested change shows up as a second,
  // unverified, non-primary entry until the user clicks the link.
  const pending = list.find((e) => !e.primary && !e.verified)

  const form = useForm({
    defaultValues: { email: '' },
    onSubmit: async ({ value }) => {
      if (change.isPending) return
      const res = await change.mutateAsync(value.email.trim())
      if (res.status === 200 || res.status === 201) {
        toast.success('Verification sent to your new address.')
        form.reset()
        return
      }
      const msg = bannerError(res, 'Could not change email. Try again.')
      if (msg) toast.error(msg)
    },
    validators: { onSubmit: schema },
  })
  const parsed = parseAllAuthErrors(change.data)

  return (
    <SettingsPageShell
      breadcrumbs={[{ label: 'Settings', to: '/settings' }, { label: 'Change email' }]}
      title="Change email"
      description="We send a verification link to the new address. Your current email stays active until you click it."
    >
      <dl className={`${settingsCard} divide-border grid grid-cols-1 divide-y overflow-hidden text-sm`}>
        <div className="flex items-center justify-between p-4">
          <dt className="text-muted-foreground">Current email</dt>
          <dd className="font-medium">{primary?.email ?? '—'}</dd>
        </div>
        {pending ? (
          <div className="flex items-center justify-between p-4">
            <dt className="text-muted-foreground">Pending (unverified)</dt>
            <dd className="text-warning inline-flex items-center gap-1">
              <MailCheck className="h-4 w-4" aria-hidden="true" /> {pending.email}
            </dd>
          </div>
        ) : null}
      </dl>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          form.handleSubmit()
        }}
        className={`${settingsCard} space-y-4 p-4`}
      >
        <form.Field name="email">
          {(field) => {
            const errMsg =
              fieldErrorMessage(field.state.meta.errors[0]) ?? parsed.byField['email']?.[0]
            return (
              <div className="space-y-1">
                <label htmlFor={field.name} className="text-sm font-medium">
                  New email
                </label>
                <Input
                  id={field.name}
                  type="email"
                  autoComplete="email"
                  required
                  aria-required="true"
                  aria-invalid={errMsg ? true : undefined}
                  aria-errormessage={errMsg ? `${field.name}-error` : undefined}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                <FormError id={`${field.name}-error`} message={errMsg} />
              </div>
            )
          }}
        </form.Field>

        <Button
          type="submit"
          disabled={change.isPending}
          aria-busy={change.isPending || undefined}
          className="w-full"
        >
          {change.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              Sending…
            </>
          ) : (
            'Send verification link'
          )}
        </Button>
      </form>
    </SettingsPageShell>
  )
}
