import { useForm } from '@tanstack/react-form'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'

import { settingsCard, SettingsPageShell } from '@/components/layout/settings-page-shell'
import { Button } from '@/components/ui/button'
import { FormError } from '@/components/ui/form-error'
import { Input } from '@/components/ui/input'
import { bannerError, fieldErrorMessage, parseAllAuthErrors } from '@/lib/auth/errors'
import { useChangePassword } from '@/lib/hooks/mutations/auth'

export const Route = createFileRoute('/account/password/change')({
  component: ChangePasswordPage,
  head: () => ({ meta: [{ title: 'Change password — music' }] }),
})

const schema = z
  .object({
    current: z.string().min(1, 'Required'),
    // NIST 2026: length over complexity. Backend additionally screens against
    // the haveibeenpwned breach list.
    password: z.string().min(12, 'At least 12 characters'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: 'Passwords don’t match',
    path: ['confirm'],
  })

function ChangePasswordPage() {
  const navigate = useNavigate()
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
        navigate({ to: '/settings' })
        return
      }
      // Field-bound errors (wrong current password, weak/breached new
      // password) render inline below. Form-level failures toast.
      const msg = bannerError(res, 'Could not change password. Try again.')
      if (msg) toast.error(msg)
    },
    validators: { onSubmit: schema },
  })
  const parsed = parseAllAuthErrors(change.data)

  return (
    <SettingsPageShell
      breadcrumbs={[{ label: 'Settings', to: '/settings' }, { label: 'Change password' }]}
      title="Change password"
      description="Enter your current password, then choose a new one. At least 12 characters; we screen against known-breached passwords."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          form.handleSubmit()
        }}
        className={`${settingsCard} space-y-4 p-4`}
      >
        <form.Field name="current">
          {(field) => {
            const errMsg =
              fieldErrorMessage(field.state.meta.errors[0]) ??
              parsed.byField['current_password']?.[0]
            return (
              <div className="space-y-1">
                <label htmlFor={field.name} className="text-sm font-medium">
                  Current password
                </label>
                <Input
                  id={field.name}
                  type="password"
                  autoComplete="current-password"
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

        <form.Field name="password">
          {(field) => {
            const errMsg =
              fieldErrorMessage(field.state.meta.errors[0]) ?? parsed.byField['new_password']?.[0]
            return (
              <div className="space-y-1">
                <label htmlFor={field.name} className="text-sm font-medium">
                  New password
                </label>
                <Input
                  id={field.name}
                  type="password"
                  autoComplete="new-password"
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

        <form.Field name="confirm">
          {(field) => {
            const errMsg = fieldErrorMessage(field.state.meta.errors[0])
            return (
              <div className="space-y-1">
                <label htmlFor={field.name} className="text-sm font-medium">
                  Confirm new password
                </label>
                <Input
                  id={field.name}
                  type="password"
                  autoComplete="new-password"
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
              Changing…
            </>
          ) : (
            'Change password'
          )}
        </Button>
      </form>
    </SettingsPageShell>
  )
}
