---
name: frontend-performance
description: Frontend performance optimization for React and Next.js. Covers eliminating async waterfalls, bundle size optimization, re-render prevention, client-side data fetching patterns, JS performance, and Suspense boundaries. Use when optimizing performance, fixing waterfalls, or reducing bundle size.
---

# Frontend Performance

Frontend performance optimization for React and Next.js. 40+ rules across 8 categories, prioritized by impact.

Adapted from Vercel Engineering's React Best Practices (v1.0.0, January 2026).

### 1. Eliminating Waterfalls — CRITICAL

Waterfalls are the #1 performance killer. Each sequential await adds full network latency.

#### 1.1 Defer Await Until Needed

Move `await` into the branch where it's used. Don't block unused code paths.

```tsx
// ❌ Waterfall — awaits data even if not needed
async function Page({ params }: { params: { id: string } }) {
  const user = await fetchUser(params.id)
  const posts = await fetchPosts(params.id)
  return <Profile user={user} posts={posts} />
}

// ✅ Start both immediately, await together
async function Page({ params }: { params: { id: string } }) {
  const userPromise = fetchUser(params.id)
  const postsPromise = fetchPosts(params.id)
  const [user, posts] = await Promise.all([userPromise, postsPromise])
  return <Profile user={user} posts={posts} />
}
```

#### 1.2 Dependency-Based Parallelization

Start independent promises immediately, await them together:

```tsx
const userPromise = fetchUser(id)
const postsPromise = fetchPosts(id)
const [user, posts] = await Promise.all([userPromise, postsPromise])
```

For dependent chains, parallelize what you can:

```tsx
const user = await fetchUser(id)
// These depend on user but not on each other
const [posts, settings] = await Promise.all([fetchPosts(user.id), fetchSettings(user.id)])
```

#### 1.3 Prevent Waterfall Chains in API Routes

Parallelize DB queries with `Promise.all` in API routes:

```tsx
// ❌ Sequential — each query waits for the previous
export async function GET(req: Request) {
  const user = await supabase.from('users').select('*').eq('id', userId).single()
  const workspace = await supabase.from('workspaces').select('*').eq('id', workspaceId).single()
  const settings = await supabase
    .from('settings')
    .select('*')
    .eq('workspace_id', workspaceId)
    .single()
  return Response.json({ user, workspace, settings })
}

// ✅ Parallel — all three fire at once
export async function GET(req: Request) {
  const [user, workspace, settings] = await Promise.all([
    supabase.from('users').select('*').eq('id', userId).single(),
    supabase.from('workspaces').select('*').eq('id', workspaceId).single(),
    supabase.from('settings').select('*').eq('workspace_id', workspaceId).single(),
  ])
  return Response.json({ user: user.data, workspace: workspace.data, settings: settings.data })
}
```

#### 1.4 Promise.all() for Independent Operations

NEVER sequential `await` for unrelated calls. This applies everywhere — server components, API routes, client-side hooks, mutations.

#### 1.5 Strategic Suspense Boundaries

Wrap slow data sources in their own Suspense boundary so the rest of the page renders immediately:

```tsx
async function Page() {
  return (
    <div>
      <Header />
      <Suspense fallback={<DashboardSkeleton />}>
        <Dashboard />
      </Suspense>
      <Suspense fallback={<ActivitySkeleton />}>
        <SlowActivityFeed />
      </Suspense>
      <Footer />
    </div>
  )
}
```

**Rules for Suspense boundaries:**

- Wrap each independent async data source
- Place boundaries as close to the data source as possible
- Don't wrap purely synchronous components
- Use meaningful skeleton/fallback components, not generic spinners

### 2. Bundle Size Optimization — CRITICAL

#### 2.1 Analyze Bundle Composition

Use `@next/bundle-analyzer` to identify large dependencies:

```bash
ANALYZE=true pnpm build
```

#### 2.2 Conditional Module Loading

```tsx
const DevTools =
  process.env.NODE_ENV === 'development' ? React.lazy(() => import('./DevTools')) : () => null
```

#### 2.3 Defer Non-Critical Third-Party Libraries

Load analytics, chat widgets, etc. after initial render:

```tsx
useEffect(() => {
  // Load analytics after hydration
  import('posthog-js').then((posthog) => {
    posthog.default.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!)
  })
}, [])
```

#### 2.4 Dynamic Imports for Heavy Components

Use `next/dynamic` with `{ ssr: false }` for charts, editors, devtools:

```tsx
import dynamic from 'next/dynamic'

const Chart = dynamic(() => import('@/components/Chart'), {
  ssr: false,
  loading: () => <ChartSkeleton />,
})

const RichTextEditor = dynamic(() => import('@/components/RichTextEditor'), {
  ssr: false,
})
```

#### 2.5 Preload Based on User Intent

Prefetch on hover for instant navigation:

```tsx
function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const router = useRouter()

  return (
    <Link href={href} onMouseEnter={() => router.prefetch(href)}>
      {children}
    </Link>
  )
}
```

Also prefetch React Query data on hover:

```tsx
function ContractCard({ contract }: { contract: Contract }) {
  const queryClient = useQueryClient()

  return (
    <Link
      href={`/contracts/${contract.id}`}
      onMouseEnter={() => {
        queryClient.prefetchQuery({
          queryKey: contractKeys.detail(contract.id),
          queryFn: () => fetchContract(contract.id),
        })
      }}
    >
      {contract.title}
    </Link>
  )
}
```

#### 2.6 Tree-Shakeable Imports

```tsx
// ❌ Imports entire library
import { format } from 'date-fns'

// ✅ Import only what you need (if the library supports it)
import format from 'date-fns/format'
```

```tsx
// ❌ Imports all icons
import * as Icons from 'lucide-react'

// ✅ Named import — tree-shaken
import { Search, Plus, X } from 'lucide-react'
```

### 3. Server Components and Streaming — HIGH

#### 3.1 Default to Server Components

In Next.js App Router, components are Server Components by default. Only add `"use client"` when you need:

- Event handlers (`onClick`, `onChange`)
- Browser APIs (`localStorage`, `window`)
- React hooks (`useState`, `useEffect`, `useRef`)
- Third-party client-only libraries

#### 3.2 Push `"use client"` Boundary Down

Don't make an entire page a Client Component because one button needs `onClick`. Extract the interactive part:

```tsx
// ❌ Entire page is client
'use client'
export default function Page() {
  return (
    <div>
      <h1>Dashboard</h1>
      <StaticContent />
      <button onClick={() => setOpen(true)}>Open</button>
    </div>
  )
}

// ✅ Only the interactive part is client
// page.tsx (Server Component)
export default function Page() {
  return (
    <div>
      <h1>Dashboard</h1>
      <StaticContent />
      <OpenButton />
    </div>
  )
}

// OpenButton.tsx
;('use client')
function OpenButton() {
  const [open, setOpen] = useState(false)
  return <button onClick={() => setOpen(true)}>Open</button>
}
```

#### 3.3 Streaming with Loading States

Use `loading.tsx` files for route-level streaming:

```
app/
├── dashboard/
│   ├── page.tsx         # Server Component with async data
│   └── loading.tsx      # Shown immediately while page loads
```

### 4. Client-Side Data Fetching — MEDIUM-HIGH

#### 4.1 Deduplicate Global Event Listeners

Don't add `visibilitychange`, `online`, or `resize` listeners manually — React Query and Next.js handle these.

#### 4.2 Use Passive Event Listeners for Scrolling

```tsx
useEffect(() => {
  const handler = () => {
    /* scroll logic */
  }
  window.addEventListener('scroll', handler, { passive: true })
  return () => window.removeEventListener('scroll', handler)
}, [])
```

#### 4.3 Use React Query for Automatic Deduplication

Multiple components calling the same `useQuery` hook = one network request:

```tsx
// Both components share the same cache entry and network request
function Header() {
  const { data: user } = useUser()
  return <span>{user?.name}</span>
}

function Sidebar() {
  const { data: user } = useUser()
  return <span>{user?.email}</span>
}
```

#### 4.4 Version and Minimize localStorage Data

```tsx
const CACHE_VERSION = 2
const CACHE_KEY = `app-cache-v${CACHE_VERSION}`

// Store only what's needed, with version
localStorage.setItem(CACHE_KEY, JSON.stringify({ version: CACHE_VERSION, data: minimal }))
```

#### 4.5 Stale-While-Revalidate Pattern

Configure React Query for optimal cache behavior:

```tsx
useQuery({
  queryKey: contractKeys.list(workspaceId),
  queryFn: fetchContracts,
  staleTime: 2 * 60 * 1000, // 2 min — data considered fresh
  gcTime: 30 * 60 * 1000, // 30 min — cache kept in memory
})
```

### 5. Re-render Optimization — MEDIUM

#### Key Rules:

- **Calculate derived state during rendering** — don't useState + useEffect
- **Defer state reads to usage point** — don't read state higher than needed
- **Don't wrap simple primitives in useMemo** — React Compiler handles memoization
- **Extract default non-primitive values to constants** outside the component
- **Extract to memoized components** for expensive subtrees
- **Narrow effect dependencies** — use specific values, not entire objects
- **Put interaction logic in event handlers**, not useEffect
- **Subscribe to derived state** (Zustand `select`, React Query `select`)
- **Use functional setState** — `setState(prev => prev + 1)` removes state from dependency arrays
- **Use lazy state initialization** — `useState(() => expensiveComputation())`
- **Use transitions for non-urgent updates** — `useTransition`/`useDeferredValue`
- **Use useRef for transient values** — values that change but shouldn't trigger re-render

```tsx
// ❌ Derived state with useState + useEffect
const [filteredItems, setFilteredItems] = useState(items)
useEffect(() => {
  setFilteredItems(items.filter((i) => i.status === status))
}, [items, status])

// ✅ Calculate during render
const filteredItems = items.filter((i) => i.status === status)
```

```tsx
// ❌ Reading entire Zustand store
const store = useStore()

// ✅ Subscribe to specific field
const activeTab = useStore((s) => s.activeTab)
```

```tsx
// ❌ Non-urgent update blocks UI
function SearchInput() {
  const [query, setQuery] = useState('')
  const results = expensiveSearch(query)
  return <input value={query} onChange={(e) => setQuery(e.target.value)} />
}

// ✅ Deferred value keeps input responsive
function SearchInput() {
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const results = expensiveSearch(deferredQuery)
  return <input value={query} onChange={(e) => setQuery(e.target.value)} />
}
```

### 6. Rendering Performance — MEDIUM

- **Animate SVG wrappers, not SVG elements** — animating `<g>` or wrapper `<div>` is cheaper than individual SVG paths
- **Hoist static JSX elements outside render** — if it doesn't depend on props/state, define it outside the component
- **Optimize SVG decimal precision** — reduce SVG path precision to 1-2 decimal places
- **Prevent hydration mismatch without flickering** — use `suppressHydrationWarning` for timestamps, use `useId()` for random values
- **Use `<Activity>` for show/hide without unmounting** — preserves state and DOM
- **Use explicit conditional rendering** — `{condition && <Component />}` not `<Component style={{ display: condition ? "block" : "none" }}>`
- **Use `useTransition` over manual loading states** — `startTransition` keeps current UI visible while loading

```tsx
// ❌ Static content recreated every render
function Page() {
  const header = (
    <header>
      <h1>Dashboard</h1>
    </header>
  )
  return (
    <div>
      {header}
      {content}
    </div>
  )
}

// ✅ Static content hoisted outside
const header = (
  <header>
    <h1>Dashboard</h1>
  </header>
)
function Page() {
  return (
    <div>
      {header}
      {content}
    </div>
  )
}
```

### 7. JavaScript Performance — LOW-MEDIUM

- **Avoid layout thrashing** — batch reads then writes to avoid forced reflows
- **Build index maps (`Map`/`Set`) for repeated lookups** — O(1) vs O(n)
- **Cache property access and function calls in loops** — store `array.length` in variable
- **Combine multiple array iterations into single pass** — `.filter().map()` → single `.reduce()`
- **Early length check for array comparisons** — check lengths before deep comparison
- **Early return from functions** — guard clauses reduce nesting and improve readability
- **Hoist RegExp creation outside loops/renders** — `new RegExp()` is expensive
- **Use `toSorted()` instead of `sort()`** for immutability — critical with React Compiler

```tsx
// ❌ O(n) lookup on every render
function UserName({ userId, users }: { userId: string; users: User[] }) {
  const user = users.find((u) => u.id === userId)
  return <span>{user?.name}</span>
}

// ✅ O(1) lookup with index map
const userMap = new Map(users.map((u) => [u.id, u]))
function UserName({ userId }: { userId: string }) {
  const user = userMap.get(userId)
  return <span>{user?.name}</span>
}
```

```tsx
// ❌ Multiple array passes
const active = items.filter((i) => i.active)
const names = active.map((i) => i.name)
const sorted = names.toSorted()

// ✅ Single pass
const sorted = items
  .reduce<string[]>((acc, i) => {
    if (i.active) acc.push(i.name)
    return acc
  }, [])
  .toSorted()
```

### 8. Advanced Patterns — LOW

- **Initialize app once, not per mount** — use module-level flags to prevent re-initialization

```tsx
let initialized = false

function App() {
  useEffect(() => {
    if (initialized) return
    initialized = true
    // One-time setup
  }, [])
}
```

- **Store event handlers in refs for stable references** — prevents child re-renders from callback changes

```tsx
function useStableCallback<T extends (...args: unknown[]) => unknown>(callback: T): T {
  const ref = useRef(callback)
  ref.current = callback
  return ((...args) => ref.current(...args)) as T
}
```

- **`useEffectEvent` for stable callback refs** — React 19 API for callbacks that read latest state without being in dependency arrays

### Image Optimization

- Always use `next/image` — automatic WebP/AVIF, lazy loading, responsive sizing
- Set explicit `width` and `height` to prevent layout shift (CLS)
- Use `priority` for above-the-fold images (LCP)
- Use `sizes` prop for responsive images

```tsx
import Image from 'next/image'
;<Image
  src="/hero.jpg"
  alt="Hero image"
  width={1200}
  height={600}
  priority // Above the fold
  sizes="(max-width: 768px) 100vw, 50vw"
/>
```

### Performance Monitoring

- Use Vercel Speed Insights or Web Vitals API to track Core Web Vitals
- Monitor LCP (Largest Contentful Paint), FID/INP (Interaction to Next Paint), CLS (Cumulative Layout Shift)
- Set performance budgets: LCP < 2.5s, INP < 200ms, CLS < 0.1
- Use React DevTools Profiler to identify unnecessary re-renders in development
