import { createFileRoute } from '@tanstack/react-router'

import { MarkdownContent } from '@/components/docs/markdown'
import { getDoc } from '@/lib/docs/registry'

/**
 * `/docs` — landing page. Renders `docs/README.md` (the topic index) so
 * the user sees an overview before drilling into a specific doc.
 */
export const Route = createFileRoute('/docs/')({
  component: DocsIndex,
})

function DocsIndex() {
  const content = getDoc('README.md') ?? '# Docs\n\nNo `docs/README.md` found.'
  return <MarkdownContent content={content} currentPath="README.md" />
}
