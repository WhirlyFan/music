/**
 * In-app docs viewer registry.
 *
 * Pulls every `.md` file in the repo's top-level `docs/` directory via
 * Vite's `import.meta.glob` with `eager: true` + `query: '?raw'`. That
 * bundles the file contents into the SPA at build time — no runtime
 * fetch, no backend endpoint, no manual list to maintain. Drop a new
 * `.md` file into `docs/`, refresh, and it appears in the sidebar.
 *
 * Path resolution: Vite's `/`-prefixed glob paths are project-root
 * relative. We bind-mount the repo's `docs/` at `/app/_docs` (see
 * docker-compose.yml `frontend.volumes`) so `'/_docs/**'` resolves
 * correctly inside the container. The `_docs` name avoids collisions
 * with any future `frontend/docs/` source directory.
 */

const RAW_PREFIX = '/_docs/'

const modules = import.meta.glob('/_docs/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/** Map of `docs/`-relative path → raw markdown content. */
export const docs: Record<string, string> = Object.fromEntries(
  Object.entries(modules).map(([k, v]) => [k.slice(RAW_PREFIX.length), v]),
)

export type DocEntry = {
  /** Path relative to `docs/`, e.g. `auth.md`, `decisions/0008-...md`. */
  path: string
  /** First `# Heading` of the file, or the filename as a fallback. */
  title: string
}

function extractTitle(md: string, fallback: string): string {
  const match = md.match(/^#\s+(.+?)$/m)
  return match ? match[1].trim() : fallback
}

/** Every doc, in stable alphabetical order. */
export function listDocs(): DocEntry[] {
  return Object.entries(docs)
    .map(([path, content]) => ({ path, title: extractTitle(content, path) }))
    .sort((a, b) => a.path.localeCompare(b.path))
}

/** Raw markdown for a given `docs/`-relative path, or null if missing. */
export function getDoc(path: string): string | null {
  return docs[path] ?? null
}

export type DocGroup = {
  /** Human label shown above the group in the sidebar. */
  label: string
  /** Entries to render, in the order they should appear. */
  entries: DocEntry[]
}

/**
 * Group the doc list into sidebar sections. Top-level files first, then
 * one section per subdirectory (architecture/, ops/, decisions/, …).
 *
 * `README.md` is special-cased to be the first entry under "Getting started"
 * so the docs landing page is obvious.
 */
export function groupDocs(entries: DocEntry[]): DocGroup[] {
  const topLevel: DocEntry[] = []
  const bySubdir = new Map<string, DocEntry[]>()

  for (const e of entries) {
    const slash = e.path.indexOf('/')
    if (slash === -1) {
      topLevel.push(e)
      continue
    }
    const dir = e.path.slice(0, slash)
    const bucket = bySubdir.get(dir) ?? []
    bucket.push(e)
    bySubdir.set(dir, bucket)
  }

  const groups: DocGroup[] = []
  const readme = topLevel.find((e) => e.path === 'README.md')
  const rest = topLevel.filter((e) => e.path !== 'README.md')
  if (readme) {
    groups.push({ label: 'Getting started', entries: [readme] })
  }
  if (rest.length) {
    groups.push({ label: 'Topics', entries: rest })
  }

  // Sub-directories: known dirs get pretty labels; unknown dirs use titlecase.
  const subdirLabels: Record<string, string> = {
    architecture: 'Architecture',
    ops: 'Operations',
    decisions: 'Decisions',
  }
  const orderedDirs = ['architecture', 'ops', 'decisions']
  for (const dir of orderedDirs) {
    const dirEntries = bySubdir.get(dir)
    if (dirEntries) {
      groups.push({ label: subdirLabels[dir] ?? dir, entries: dirEntries })
      bySubdir.delete(dir)
    }
  }
  for (const [dir, list] of bySubdir) {
    groups.push({
      label: subdirLabels[dir] ?? dir.charAt(0).toUpperCase() + dir.slice(1),
      entries: list,
    })
  }
  return groups
}
