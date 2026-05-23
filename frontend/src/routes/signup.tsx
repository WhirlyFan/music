import { useForm } from '@tanstack/react-form'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useSignup } from '@/lib/auth/hooks'

export const Route = createFileRoute('/signup')({
  component: SignupPage,
})

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'At least 8 characters'),
})

function SignupPage() {
  const navigate = useNavigate()
  const signup = useSignup()

  const form = useForm({
    defaultValues: { email: '', password: '' },
    onSubmit: async ({ value }) => {
      const result = await signup.mutateAsync(value)
      if (result.status === 200) navigate({ to: '/notes' })
    },
    validators: { onChange: signupSchema },
  })

  return (
    <div className="mx-auto max-w-sm space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Create an account</h1>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          form.handleSubmit()
        }}
        className="space-y-4"
      >
        <form.Field name="email">
          {(field) => (
            <div className="space-y-1">
              <label htmlFor={field.name} className="text-sm font-medium">
                Email
              </label>
              <Input
                id={field.name}
                type="email"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            </div>
          )}
        </form.Field>

        <form.Field name="password">
          {(field) => (
            <div className="space-y-1">
              <label htmlFor={field.name} className="text-sm font-medium">
                Password
              </label>
              <Input
                id={field.name}
                type="password"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            </div>
          )}
        </form.Field>

        <Button type="submit" disabled={signup.isPending} className="w-full">
          {signup.isPending ? 'Creating…' : 'Create account'}
        </Button>

        {signup.isError && (
          <p className="text-sm text-destructive">
            {String((signup.error as Error).message ?? 'Signup failed')}
          </p>
        )}
      </form>
    </div>
  )
}
