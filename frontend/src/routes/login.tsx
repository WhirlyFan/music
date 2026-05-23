import { useForm } from '@tanstack/react-form'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useLogin } from '@/lib/auth/hooks'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

function LoginPage() {
  const navigate = useNavigate()
  const login = useLogin()

  const form = useForm({
    defaultValues: { email: '', password: '' },
    onSubmit: async ({ value }) => {
      const result = await login.mutateAsync(value)
      if (result.status === 200) navigate({ to: '/notes' })
    },
    validators: { onChange: loginSchema },
  })

  return (
    <div className="mx-auto max-w-sm space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Log in</h1>

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

        <Button type="submit" disabled={login.isPending} className="w-full">
          {login.isPending ? 'Logging in…' : 'Log in'}
        </Button>

        {login.isError && (
          <p className="text-destructive text-sm">
            {String((login.error as Error).message ?? 'Login failed')}
          </p>
        )}
      </form>
    </div>
  )
}
