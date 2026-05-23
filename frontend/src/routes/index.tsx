import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: Index,
})

function Index() {
  return (
    <div className="space-y-3">
      <h1 className="text-3xl font-semibold tracking-tight">Welcome.</h1>
      <p className="text-muted-foreground">
        Django + DRF + RLS + TanStack + shadcn. Sign up to try it.
      </p>
    </div>
  )
}
