import { createFileRoute } from '@tanstack/react-router'

import { Button } from '@/components/ui/button'

export const Route = createFileRoute('/')({
  component: Index,
})

function Index() {
  return (
    <div className="space-y-10">
      <section className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">Welcome.</h1>
        <p className="text-muted-foreground">
          Django + DRF + RLS + TanStack + shadcn. Sign up to try it.
        </p>
        <div className="flex gap-2 pt-2">
          <Button>Primary action</Button>
          <Button variant="outline">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Design tokens</h2>
        <p className="text-muted-foreground text-sm">
          Every color is a CSS variable. Use the avatar menu → Theme to flip light/dark.
        </p>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Swatch name="primary" bgClass="bg-primary" fgClass="text-primary-foreground" />
          <Swatch name="accent" bgClass="bg-accent" fgClass="text-accent-foreground" />
          <Swatch name="secondary" bgClass="bg-secondary" fgClass="text-secondary-foreground" />
          <Swatch name="muted" bgClass="bg-muted" fgClass="text-muted-foreground" />
          <Swatch name="success" bgClass="bg-success" fgClass="text-success-foreground" />
          <Swatch name="warning" bgClass="bg-warning" fgClass="text-warning-foreground" />
          <Swatch name="info" bgClass="bg-info" fgClass="text-info-foreground" />
          <Swatch
            name="destructive"
            bgClass="bg-destructive"
            fgClass="text-destructive-foreground"
          />
        </div>
      </section>
    </div>
  )
}

function Swatch({ name, bgClass, fgClass }: { name: string; bgClass: string; fgClass: string }) {
  return (
    <div
      className={`border-border flex h-20 items-center justify-center rounded-md border ${bgClass} ${fgClass}`}
    >
      <span className="text-sm font-medium">{name}</span>
    </div>
  )
}
