---
name: frontend-component-design
description: Frontend component design and styling with shadcn/ui, CVA variants, DataTable (TanStack Table), virtualization, design tokens, cn/tailwind-merge, data-state/data-slot attributes, and page shell patterns. Use when building or styling UI components, tables, or page layouts.
---
# Frontend Component Design

Frontend component design and styling with shadcn/ui, CVA variants, DataTable (TanStack Table), virtualization, design tokens, cn/tailwind-merge, data-state/data-slot attributes, and page shell patterns.

### Three-Layer Styling Architecture

#### Layer 1: Design Tokens (CSS Variables)

Defined in `globals.css`. Components reference via Tailwind classes like `bg-primary`, `text-muted-foreground`.

```css
/* globals.css */
:root {
  --background: 0 0% 100%;
  --foreground: 222.2 84% 4.9%;
  --primary: 222.2 47.4% 11.2%;
  --primary-foreground: 210 40% 98%;
  --muted: 210 40% 96.1%;
  --muted-foreground: 215.4 16.3% 46.9%;
  --accent: 210 40% 96.1%;
  --accent-foreground: 222.2 47.4% 11.2%;
  --destructive: 0 84.2% 60.2%;
  --border: 214.3 31.8% 91.4%;
  --ring: 222.2 84% 4.9%;
  --radius: 0.5rem;
  --color-focus: 222.2 84% 4.9%;
}
```

**Rules:**
- Always use CSS variable references (`bg-primary`, `text-muted-foreground`) — never raw colors (`bg-blue-600`, `#1e40af`)
- Add new tokens to `globals.css` when a color/spacing/radius is used in 3+ places
- Dark mode tokens go in `.dark {}` block — components adapt automatically

#### Layer 2: Component Variants (CVA)

Inside `components/ui/*.tsx`, `cva()` defines variant props. Consumers pass attributes, never raw classes.

```tsx
import { cva, type VariantProps } from "class-variance-authority";

const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 rounded-md px-3",
        lg: "h-11 rounded-md px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);
```

**CVA Rules:**
1. Only add a variant if used in **3+ places** (Rule of Three)
2. Define in the component's `cva()` call, not as one-off `className` props
3. Use `defaultVariants` so consumers get sensible defaults
4. Define variants **outside** components to avoid recreation on every render
5. Export the variants function so other components can compose with it

#### Layer 3: Consumer Usage

Consumers pass high-level props. No Tailwind in feature code for styled primitives.

```tsx
// ✅ Consumer uses props
<Button variant="destructive" size="sm">Delete</Button>

// ❌ Consumer bypasses variants with raw Tailwind
<Button className="bg-red-500 text-white text-sm px-3 py-1">Delete</Button>
```

### Component Organization

```
frontend/components/
├── ui/                # Atomic shadcn primitives (NEVER add domain logic)
├── data-tables/       # TanStack Table infrastructure
│   ├── data-table.tsx
│   ├── data-table-types.ts
│   ├── data-table-column-converter.tsx
│   └── data-table-pagination.tsx
└── [feature]/         # Domain-specific composed components
```

### shadcn Rules

1. **You own the code** — edit `ui/` files directly when design system requires it
2. **Always use `cn()`** — ensures consumer class overrides work via `tailwind-merge`
3. **Use `VariantProps<typeof variants>`** — type-safe props
4. **NEVER add `mr-1`/`mr-2` between icons and text in Buttons** — `button.tsx` handles icon spacing
5. **Use CSS variable references** (`bg-primary`) not raw colors (`bg-blue-600`)

### Styling: cn, tailwind-merge, CVA

#### `cn()` Utility

`cn()` is `twMerge(clsx(...))` — it merges class names with Tailwind-aware conflict resolution:

```tsx
import { cn } from "@/lib/utils";

// Conflict resolution: consumer override wins
cn("px-4 py-2", "px-6") // → "py-2 px-6" (px-4 removed)

// Conditional classes
cn("base-class", isActive && "bg-primary", className)
```

#### Class Ordering in `cn()`

Base styles → Variant styles → Conditional styles → User overrides (`className` prop last)

```tsx
<div
  className={cn(
    "rounded-md border p-4",           // Base styles
    variants({ variant, size }),         // Variant styles
    isDisabled && "opacity-50",          // Conditional styles
    className                            // Consumer overrides (ALWAYS last)
  )}
/>
```

#### Migration Guide: Raw Tailwind → CVA Variant

When you see the same set of classes repeated in 3+ places:

```tsx
// Before: scattered raw Tailwind
<div className="rounded-lg border bg-card p-6 shadow-sm">...</div>
<div className="rounded-lg border bg-card p-6 shadow-sm">...</div>
<div className="rounded-lg border bg-card p-4 shadow-sm">...</div>

// After: extract to CVA variant
const cardVariants = cva("rounded-lg border bg-card shadow-sm", {
  variants: {
    padding: {
      default: "p-6",
      compact: "p-4",
    },
  },
  defaultVariants: { padding: "default" },
});
```

### Data Attributes for State & Identification

#### `data-state` for Visual States

Expose component state declaratively instead of prop explosion. Consumers style via attribute selectors:

```tsx
// Component exposes state
<Dialog data-state={isOpen ? "open" : "closed"}>
  <DialogOverlay data-state={isOpen ? "open" : "closed"} />
  <DialogContent data-state={isOpen ? "open" : "closed"}>
    {children}
  </DialogContent>
</Dialog>

// Consumer styles via data attributes
// data-[state=open]:opacity-100
// data-[state=closed]:opacity-0
// data-[state=open]:animate-in
// data-[state=closed]:animate-out
```

Common `data-state` values:

| Component | States |
|-----------|--------|
| Dialog/Sheet | `open`, `closed` |
| Accordion | `open`, `closed` |
| Checkbox | `checked`, `unchecked`, `indeterminate` |
| Toggle | `on`, `off` |
| Tab | `active`, `inactive` |
| Collapsible | `open`, `closed` |

#### `data-slot` for Component Identification

Stable identifiers for parent-to-child targeting. Unlike classes, `data-slot` values don't change with styling:

```tsx
// Component marks its slots
function FormField({ children, label, error }) {
  return (
    <div data-slot="form-field">
      <label data-slot="form-label">{label}</label>
      <div data-slot="form-control">{children}</div>
      {error && <p data-slot="form-error">{error}</p>}
    </div>
  );
}

// Parent targets slots for layout
// has-[>[data-slot=checkbox-group]]:gap-3
// [&_[data-slot=form-error]]:text-destructive
// [&_[data-slot=form-label]]:font-medium
```

#### Naming Conventions

* Use **kebab-case**: `data-slot="form-field"`
* Be **specific**: `data-slot="submit-button"` not `data-slot="button"`
* Match **component purpose**, not appearance
* Prefix with component name for uniqueness: `data-slot="dialog-close"` not `data-slot="close"`

### Design Tokens

Design tokens are the single source of truth for visual decisions. They live in CSS variables in `globals.css` and are consumed via Tailwind utility classes.

#### Token Categories

| Category | Example Variable | Tailwind Usage |
|----------|-----------------|----------------|
| Color | `--primary` | `bg-primary`, `text-primary` |
| Foreground | `--primary-foreground` | `text-primary-foreground` |
| Border | `--border` | `border-border` |
| Radius | `--radius` | `rounded-[var(--radius)]` |
| Ring | `--ring` | `ring-ring` |
| Muted | `--muted` | `bg-muted`, `text-muted-foreground` |

#### Adding New Tokens

1. Add the CSS variable to `:root` (and `.dark` if needed) in `globals.css`
2. Register it in `tailwind.config.ts` if it needs a custom utility class
3. Use the Tailwind utility in components — never reference `var(--token)` directly in className

### Data Tables

All tables with sorting, pagination, filtering, or selection use `<DataTable>`. Use raw shadcn `<Table>` only for simple static displays.

```tsx
// Simple static table — use shadcn Table
<Table>
  <TableHeader>
    <TableRow>
      <TableHead>Name</TableHead>
      <TableHead>Status</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    {items.map((item) => (
      <TableRow key={item.id}>
        <TableCell>{item.name}</TableCell>
        <TableCell>{item.status}</TableCell>
      </TableRow>
    ))}
  </TableBody>
</Table>

// Interactive table — use DataTable
<DataTable
  columns={columns}
  data={data}
  searchKey="name"
  pagination
/>
```

### Page Shell / View Scaffold Pattern

Reusable compound component with named slots for standard page chrome. Every page with a title + content area should use it.

```tsx
// Page shell compound component
<PageShell>
  <PageShell.Breadcrumbs>
    <Breadcrumb items={[{ label: "Home", href: "/" }, { label: "Settings" }]} />
  </PageShell.Breadcrumbs>
  <PageShell.Header>
    <PageShell.Title>Settings</PageShell.Title>
    <PageShell.Description>Manage your workspace settings.</PageShell.Description>
    <PageShell.Actions>
      <Button>Save Changes</Button>
    </PageShell.Actions>
  </PageShell.Header>
  <PageShell.Content>
    {/* Page content */}
  </PageShell.Content>
  <PageShell.Sidebar>
    {/* Optional sidebar */}
  </PageShell.Sidebar>
</PageShell>
```

**Benefits:**
- Consistent spacing, heading hierarchy, and responsive behavior across all pages
- Named slots prevent layout drift — new pages automatically match the design system
- Actions slot handles responsive collapse to menu on small screens

### Dual API: Composition + Configuration

Build compound components first (composition API), then configured wrappers for the 80% case:

```tsx
// Composition API (full control)
<Select>
  <SelectTrigger>
    <SelectValue placeholder="Pick a fruit" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="apple">Apple</SelectItem>
    <SelectItem value="banana">Banana</SelectItem>
  </SelectContent>
</Select>

// Configuration API (convenience wrapper)
<SimpleSelect
  placeholder="Pick a fruit"
  options={[
    { value: "apple", label: "Apple" },
    { value: "banana", label: "Banana" },
  ]}
/>
```

**Rules:**
1. **Composition first** — always build compound component API before configured wrapper
2. **Wrapper uses compound components** — no parallel implementation
3. **Rule of Three** — only create wrapper when pattern repeats 3+ times
4. **Escape hatch** — consumer drops to composition API when wrapper can't handle a case
5. **Don't nest wrappers** — if a wrapper needs another wrapper, use composition API instead

### Virtualization

For lists with 50+ items, use TanStack Virtual to only render visible DOM nodes:

```tsx
import { useVirtualizer } from "@tanstack/react-virtual";

function VirtualList({ items }) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 50,
  });

  return (
    <div ref={parentRef} style={{ height: "400px", overflow: "auto" }}>
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
        {virtualizer.getVirtualItems().map((virtualItem) => (
          <div
            key={virtualItem.key}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: `${virtualItem.size}px`,
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            {items[virtualItem.index].name}
          </div>
        ))}
      </div>
    </div>
  );
}
```

**Important:** Use callback ref + state for scroll containers that can unmount/remount — not `useRef`.

### When to Use What

| Scenario                               | Use                                     |
| -------------------------------------- | --------------------------------------- |
| Static display, no interactivity       | shadcn `<Table>` directly               |
| Table with sort/filter/paginate/select | `<DataTable>` (TanStack Table + shadcn) |
| Long scrollable list (50+ items)       | TanStack Virtual                        |
| Styled button/badge/card/input         | shadcn primitive with variant props     |
| Domain-specific card/panel (3+ uses)   | Product wrapper around shadcn primitive |
| One-off custom styling                 | Pass `className` to shadcn component    |
| Form with validation                   | TanStack Form + Zod                     |

### Anti-Patterns

* Writing raw Tailwind in feature components for styles that should be variants
* Creating wrappers for components used only once
* Adding `mr-*` spacing between Button icons and text
* Using raw hex colors instead of CSS variable references
* Building tables without `<DataTable>` when they need sorting/filtering
* Storing table sort/filter state in Zustand — let TanStack Table own it
* Importing entire icon libraries — use tree-shakeable imports
* Nesting `cva()` calls — compose with `cn()` instead
* Using `style={{}}` for values that can be design tokens
