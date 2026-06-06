import { useForm } from '@tanstack/react-form'
import { Loader2, MailCheck } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'

import { settingsCard } from '@/components/layout/settings-page-shell'
import { Button } from '@/components/ui/button'
import { FormError } from '@/components/ui/form-error'
import { Input } from '@/components/ui/input'
import { bannerError, fieldErrorMessage, parseAllAuthErrors } from '@/lib/auth/errors'
import { type EmailAddress } from '@/lib/auth/guards'
import { useChangeEmail, useChangePassword } from '@/lib/hooks/mutations/auth'
import { useEmails } from '@/lib/hooks/queries/auth'

const emailSchema = z.object({ email: z.string().email('Enter a valid email address') })

/** Change email — inline (lives in Settings ▸ Account). Sends a verification link to
 *  the new address; the current email stays active until the link is clicked. */
export function ChangeEmailForm() {
  const emails = useEmails()
  const change = useChangeEmail()
  const list = (emails.data?.data as EmailAddress[] | undefined) ?? []
  const primary = list.find((e) => e.primary)
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
    validators: { onSubmit: emailSchema },
  })
  const parsed = parseAllAuthErrors(change.data)

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-medium">Email</h2>
        <p className="text-muted-foreground text-sm">
          We send a verification link to the new address; your current email stays active until you
          click it.
        </p>
      </div>
      <dl className={`${settingsCard} divide-border grid grid-cols-1 divide-y overflow-hidden text-sm`}>
        <div className="flex items-center justify-between gap-3 p-4">
          <dt className="text-muted-foreground">Current</dt>
          <dd className="truncate font-medium">{primary?.email ?? '—'}</dd>
        </div>
        {pending && (
          <div className="flex items-center justify-between gap-3 p-4">
            <dt className="text-muted-foreground">Pending (unverified)</dt>
            <dd className="text-warning inline-flex items-center gap-1">
              <MailCheck className="size-4" aria-hidden /> {pending.email}
            </dd>
          </div>
        )}
      </dl>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          form.handleSubmit()
        }}
        className={`${settingsCard} flex items-end gap-2 p-4`}
      >
        <form.Field name="email">
          {(field) => {
            const errMsg =
              fieldErrorMessage(field.state.meta.errors[0]) ?? parsed.byField['email']?.[0]
            return (
              <div className="flex-1 space-y-1">
                <label htmlFor={field.name} className="text-sm font-medium">
                  New email
                </label>
                <Input
                  id={field.name}
                  type="email"
                  autoComplete="email"
                  required
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
        <Button type="submit" disabled={change.isPending} aria-busy={change.isPending || undefined}>
          {change.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : 'Update'}
        </Button>
      </form>
    </div>
  )
}

const passwordSchema = z
  .object({
    current: z.string().min(1, 'Required'),
    password: z.string().min(12, 'At least 12 characters'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: 'Passwords don’t match', path: ['confirm'] })

/** Change password — inline (Settings ▸ Account). Requires the current password; the
 *  session stays alive on success. */
export function ChangePasswordForm() {
  const change = useChangePassword()
  const form = useForm({
    defaultValues: { current: '', password: '', confirm: '' },
    onSubmit: async ({ value }) => {
      if (change.isPending) return
      const res = await change.mutateAsync({
        currentPassword: value.current,
        newPassword: value.password,
      })
      if (res.status === 200) {
        toast.success('Password changed.')
        form.reset()
        return
      }
      const msg = bannerError(res, 'Could not change password. Try again.')
      if (msg) toast.error(msg)
    },
    validators: { onSubmit: passwordSchema },
  })
  const parsed = parseAllAuthErrors(change.data)

  const fields: { name: 'current' | 'password' | 'confirm'; label: string; auto: string; key?: string }[] =
    [
      { name: 'current', label: 'Current password', auto: 'current-password', key: 'current_password' },
      { name: 'password', label: 'New password', auto: 'new-password', key: 'new_password' },
      { name: 'confirm', label: 'Confirm new password', auto: 'new-password' },
    ]

  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-lg font-medium">Password</h2>
        <p className="text-muted-foreground text-sm">
          At least 12 characters; we screen against known-breached passwords.
        </p>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          form.handleSubmit()
        }}
        className={`${settingsCard} space-y-4 p-4`}
      >
        {fields.map(({ name, label, auto, key }) => (
          <form.Field key={name} name={name}>
            {(field) => {
              const errMsg =
                fieldErrorMessage(field.state.meta.errors[0]) ??
                (key ? parsed.byField[key]?.[0] : undefined)
              return (
                <div className="space-y-1">
                  <label htmlFor={field.name} className="text-sm font-medium">
                    {label}
                  </label>
                  <Input
                    id={field.name}
                    type="password"
                    autoComplete={auto}
                    required
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
        ))}
        <Button
          type="submit"
          disabled={change.isPending}
          aria-busy={change.isPending || undefined}
          className="w-full"
        >
          {change.isPending ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" aria-hidden /> Changing…
            </>
          ) : (
            'Change password'
          )}
        </Button>
      </form>
    </div>
  )
}
