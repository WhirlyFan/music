/**
 * Resolve a markdown link href to either:
 *   - An internal SPA route under `/docs/...` (for relative `.md` links)
 *   - An external URL (anything starting with `http`, `mailto:`, `#`)
 *   - A passthrough for anything we don't recognize
 *
 * Markdown docs link to each other with relative paths like
 * `[auth.md](auth.md)` or `[decisions.md](decisions.md)`. Naive
 * rendering would produce broken `/auth.md` requests; we resolve those
 * relative to the *current* doc's directory and prepend `/docs/`.
 */

export type ResolvedLink = { kind: 'internal'; href: string } | { kind: 'external'; href: string }

export function resolveDocLink(href: string | undefined, currentPath: string): ResolvedLink {
  if (!href) return { kind: 'external', href: '' }

  // Absolute URLs, fragments, mailto: → leave as-is.
  if (/^(https?:|mailto:|tel:|#)/i.test(href)) {
    return { kind: 'external', href }
  }

  // Resolve relative to the current doc's directory. URL constructor needs
  // a base — use a junk origin and a trailing slash on the dir.
  const baseDir = currentPath.includes('/')
    ? currentPath.slice(0, currentPath.lastIndexOf('/'))
    : ''
  const base = `https://x/${baseDir}${baseDir ? '/' : ''}`
  let resolved: string
  try {
    resolved = new URL(href, base).pathname.slice(1)
  } catch {
    return { kind: 'external', href }
  }

  // Strip fragment for routing; we lose the in-page anchor for cross-doc
  // links but the alternative (TanStack Router accepting hashes) needs
  // extra plumbing. Acceptable trade-off for the first cut.
  const hashIdx = resolved.indexOf('#')
  const pathOnly = hashIdx === -1 ? resolved : resolved.slice(0, hashIdx)

  // Only treat `.md` links as internal docs links. Anything else (images,
  // other types) is passed through — the browser handles it.
  if (pathOnly.endsWith('.md')) {
    return { kind: 'internal', href: `/docs/${pathOnly}` }
  }
  return { kind: 'external', href }
}
