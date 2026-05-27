import { createFileRoute, Link, notFound } from '@tanstack/react-router'

import { MarkdownContent } from '@/components/docs/markdown'
import { buttonVariants } from '@/components/ui/button'
import { getDoc } from '@/lib/docs/registry'

/**
 * `/docs/<path...>` — splat route. The `_splat` param holds anything after
 * `/docs/`, so `/docs/auth.md` → `auth.md`, `/docs/architecture/nginx.md` →
 * `architecture/nginx.md`. Looks up the markdown in the build-time-bundled
 * registry and renders it.
 */
export const Route = createFileRoute('/docs/$')({
  loader: ({ params }) => {
    const path = params._splat ?? ''
    const content = getDoc(path)
    if (content === null) throw notFound()
    return { path, content }
  },
  component: DocPage,
  notFoundComponent: DocNotFound,
})

function DocPage() {
  const { path, content } = Route.useLoaderData()
  return <MarkdownContent content={content} currentPath={path} />
}

function DocNotFound() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Doc not found</h1>
      <p className="text-muted-foreground text-sm">
        The path you requested doesn’t match a `.md` file in `docs/`.
      </p>
      <Link to="/docs" className={buttonVariants({ variant: 'default' })}>
        Back to docs
      </Link>
    </div>
  )
}
