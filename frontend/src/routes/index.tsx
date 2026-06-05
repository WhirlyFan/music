import { createFileRoute, Link } from '@tanstack/react-router'

import { OmniBox } from '@/components/import/import-hub'
import { buttonVariants } from '@/components/ui/button'
import { isSessionAuthenticated } from '@/lib/auth/guards'
import { useSession } from '@/lib/hooks/queries/auth'

export const Route = createFileRoute('/')({
  component: Index,
})

function Index() {
  const { data: session } = useSession()

  // Signed-in: the clean search/import hero. Submitting the box routes to /search
  // (song search) or /import (a pasted link) — so home stays the input, and back /
  // the logo always return here. Signed-out: a brief welcome.
  if (!isSessionAuthenticated(session)) return <Welcome />
  return (
    <div className="flex min-h-[60vh] flex-col justify-center gap-8">
      <section className="mx-auto w-full max-w-xl text-center">
        <h1 className="shimmer-text text-3xl font-semibold tracking-tight">
          What do you want to hear?
        </h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Search for a song, or paste a Spotify, Apple Music, or YouTube link.
        </p>
        <div className="mt-6">
          <OmniBox autoFocus submit />
        </div>
      </section>
    </div>
  )
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
