import { useForm } from '@tanstack/react-form'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { FormError } from '@/components/ui/form-error'
import { Input } from '@/components/ui/input'
import { friendlyAuthError, parseAllAuthErrors } from '@/lib/auth/errors'
import { useSignup } from '@/lib/auth/hooks'

export const Route = createFileRoute('/signup')({
  component: SignupPage,
  head: () => ({ meta: [{ title: 'Sign up — react-django-template' }] }),
})

// Keep this regex in sync with backend USERNAME_REGEX in apps/users/models.py.
const usernameRegex = /^[a-zA-Z0-9_-]+$/

const signupSchema = z.object({
  email: z.string().email(),
  username: z
    .string()
    .min(3, 'At least 3 characters')
    .max(30, 'At most 30 characters')
    .regex(usernameRegex, 'Letters, numbers, underscore, dash only'),
  // NIST 2026 guidance: length over complexity. No special-char / mixed-case
  // rules. Backend additionally screens against haveibeenpwned breach list.
  password: z.string().min(12, 'At least 12 characters'),
})

function SignupPage() {
  const navigate = useNavigate()
  const signup = useSignup()

  const form = useForm({
    defaultValues: { email: '', username: '', password: '' },
    onSubmit: async ({ value }) => {
      const result = await signup.mutateAsync(value)
      if (result.status === 200) navigate({ to: '/notes' })
    },
    validators: { onChange: signupSchema },
  })

  const parsed = parseAllAuthErrors(signup.data)
  const showError = signup.data && signup.data.status !== 200
  const summary = showError ? friendlyAuthError(parsed, 'Could not create account.') : null

  return (
    <div className="mx-auto max-w-sm space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Create an account</h1>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          form.handleSubmit()
        }}
        aria-describedby={summary ? 'signup-form-error' : undefined}
        className="space-y-4"
      >
        <form.Field name="email">
          {(field) => {
            const clientErr = field.state.meta.errors[0]
            const serverErr = parsed.byField['email']?.[0]
            const errMsg = (clientErr ? String(clientErr) : null) ?? serverErr
            return (
              <div className="space-y-1">
                <label htmlFor={field.name} className="text-sm font-medium">
                  Email
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

        <form.Field name="username">
          {(field) => {
            const clientErr = field.state.meta.errors[0]
            const serverErr = parsed.byField['username']?.[0]
            const errMsg = (clientErr ? String(clientErr) : null) ?? serverErr
            return (
              <div className="space-y-1">
                <label htmlFor={field.name} className="text-sm font-medium">
                  Username
                </label>
                <Input
                  id={field.name}
                  type="text"
                  autoComplete="username"
                  placeholder="your-handle"
                  required
                  aria-required="true"
                  aria-invalid={errMsg ? true : undefined}
                  aria-errormessage={errMsg ? `${field.name}-error` : undefined}
                  aria-describedby={`${field.name}-hint`}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                <FormError id={`${field.name}-error`} message={errMsg} />
                <p id={`${field.name}-hint`} className="text-xs text-muted-foreground">
                  3–30 characters: letters, numbers, underscores, dashes.
                </p>
              </div>
            )
          }}
        </form.Field>

        <form.Field name="password">
          {(field) => {
            const clientErr = field.state.meta.errors[0]
            const serverErr = parsed.byField['password']?.[0]
            const errMsg = (clientErr ? String(clientErr) : null) ?? serverErr
            return (
              <div className="space-y-1">
                <label htmlFor={field.name} className="text-sm font-medium">
                  Password
                </label>
                <Input
                  id={field.name}
                  type="password"
                  autoComplete="new-password"
                  required
                  aria-required="true"
                  aria-invalid={errMsg ? true : undefined}
                  aria-errormessage={errMsg ? `${field.name}-error` : undefined}
                  aria-describedby={`${field.name}-hint`}
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                <FormError id={`${field.name}-error`} message={errMsg} />
                <p id={`${field.name}-hint`} className="text-xs text-muted-foreground">
                  At least 12 characters. Avoid passwords used on other sites.
                </p>
              </div>
            )
          }}
        </form.Field>

        <Button
          type="submit"
          aria-busy={signup.isPending || undefined}
          aria-disabled={signup.isPending || undefined}
          className={`w-full ${signup.isPending ? 'pointer-events-none opacity-60' : ''}`}
        >
          {signup.isPending ? 'Creating…' : 'Create account'}
        </Button>

        <FormError id="signup-form-error" message={summary} />
      </form>
    </div>
  )
}
