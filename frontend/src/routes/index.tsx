import { createFileRoute, Link } from '@tanstack/react-router'

import { OmniBox } from '@/components/import/import-hub'
import { Button } from '@/components/ui/button'
import { isSessionAuthenticated } from '@/lib/auth/guards'
import { useSession } from '@/lib/hooks/queries/auth'

export const Route = createFileRoute('/')({
  component: Index,
})

function Index() {
  const { data: session } = useSession()
  if (!isSessionAuthenticated(session)) return <Welcome />

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-8 text-center">
      <h1 className="shimmer-text text-3xl font-semibold tracking-tight sm:text-4xl">
        What do you want to hear?
      </h1>
      <div className="w-full max-w-xl">
        <OmniBox autoFocus submit />
      </div>
    </div>
  )
}

function Welcome() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-8 text-center">
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Play anything.</h1>
      <div className="flex gap-3">
        <Button asChild size="lg">
          <Link to="/signup">Sign up</Link>
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link to="/login">Log in</Link>
        </Button>
      </div>
    </div>
  )
}
