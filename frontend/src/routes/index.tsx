import { createFileRoute, Link } from '@tanstack/react-router'

import { ImportHub } from '@/components/import/import-hub'
import { buttonVariants } from '@/components/ui/button'
import { isSessionAuthenticated, useSession } from '@/lib/auth/hooks'

export const Route = createFileRoute('/')({
  component: Index,
})

function Index() {
  const { data: session } = useSession()

  // Signed-in: the home page IS the import hub. Signed-out: a brief welcome.
  if (isSessionAuthenticated(session)) return <ImportHub />
  return <Welcome />
}

function Welcome() {
  return (
    <section className="mx-auto flex max-w-xl flex-col items-center pt-16 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">Play any playlist.</h1>
      <p className="text-muted-foreground mt-2">
        Paste a Spotify, Apple Music, or YouTube link and listen — no account on those services
        needed. Sign in to start.
      </p>
      <div className="mt-6 flex gap-3">
        <Link to="/signup" className={buttonVariants({ size: 'lg' })}>
          Sign up
        </Link>
        <Link to="/login" className={buttonVariants({ variant: 'outline', size: 'lg' })}>
          Log in
        </Link>
      </div>
    </section>
  )
}
