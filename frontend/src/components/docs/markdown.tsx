import { Link } from '@tanstack/react-router'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { resolveDocLink } from '@/lib/docs/links'
import { cn } from '@/lib/utils'

/**
 * Markdown renderer for the docs viewer.
 *
 * GFM (tables, task lists, autolinks) via remark-gfm. Typography is
 * hand-rolled in `index.css` under `.docs-content` so every color comes
 * from our theme tokens (`--foreground`, `--muted`, `--primary`, …) and
 * the docs match the rest of the app in both themes. Internal `.md`
 * links become SPA `<Link>`s under `/docs/`; external URLs open in a
 * new tab.
 */
export function MarkdownContent({
  content,
  currentPath,
  className,
}: {
  content: string
  currentPath: string
  className?: string
}) {
  return (
    <article className={cn('docs-content', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children, ...props }) => {
            const link = resolveDocLink(href, currentPath)
            if (link.kind === 'internal') {
              return (
                <Link to={link.href as never} {...props}>
                  {children}
                </Link>
              )
            }
            const isExternal = /^https?:/i.test(link.href)
            return (
              <a
                href={link.href}
                target={isExternal ? '_blank' : undefined}
                rel={isExternal ? 'noopener noreferrer' : undefined}
                {...props}
              >
                {children}
              </a>
            )
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </article>
  )
}
