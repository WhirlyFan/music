---
name: ux-layouts
description: Layout and responsiveness rules for components and containers. Covers mobile-first responsive design, useIsMobile() restrictions, width rules, grid layouts, flexbox patterns, responsive typography/spacing, dialog/sheet sizing, and anti-patterns. Use when building or reviewing responsive layouts.
---

# Layouts

## Layout & Responsiveness — Mandatory Rules

Every layout rule below is **mandatory**. Violations cause real breakage on mobile and tablet. No exceptions unless explicitly noted.

**Related skills:**

- `frontend-component-design` — Design tokens, CVA variants, `cn()`, `<Card>`, PageShell scaffold
- `frontend-accessibility` — Touch targets (min 44x44px), viewport zoom, focus management
- `frontend-composition` — Compound components, `asChild`, polymorphism

**Prerequisite:** All `className` values in this codebase go through `cn()` (see `frontend-component-design`). Examples below show raw strings for clarity, but in practice always wrap with `cn()`.

---

### 1. Mobile-First Responsive — The Core Rule

Write base styles for mobile (smallest screen). Override upward with breakpoint prefixes. **Never** write desktop styles first and undo them at smaller sizes.

```tsx
// WRONG — desktop-first
<div className={cn("grid grid-cols-4 gap-6")}>

// CORRECT — mobile-first
<div className={cn("grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-6")}>
```

#### Breakpoint Reference

| Prefix   | Min-width | Target                          |
| -------- | --------- | ------------------------------- |
| _(none)_ | 0 px      | Mobile base — always start here |
| `sm:`    | 640 px    | Large phones / small tablets    |
| `md:`    | 768 px    | Tablets                         |
| `lg:`    | 1024 px   | Laptops                         |
| `xl:`    | 1280 px   | Desktops                        |
| `2xl:`   | 1536 px   | Wide monitors                   |

---

### 2. `useIsMobile()` — Strict Usage Rules

`useIsMobile()` causes a JavaScript re-render on resize, cannot be server-rendered, and creates a flash of wrong layout. **Default to CSS breakpoints for everything.**

#### When `useIsMobile()` is FORBIDDEN

- Showing/hiding elements → use `hidden md:block` / `md:hidden`
- Changing flex direction → use `flex-col md:flex-row`
- Adjusting grid columns → use responsive `grid-cols-*`
- Changing widths/padding/margins → use breakpoint prefixes
- Changing text sizes → use responsive typography classes
- Swapping variants of the same component → use breakpoint classes or CSS

#### When `useIsMobile()` is ALLOWED (rare)

Only use it when you render **entirely different component trees** where CSS cannot bridge the gap:

```tsx
// ALLOWED — completely different components, not just style differences
const isMobile = useIsMobile()
return isMobile ? <MobileKanbanView /> : <DesktopTableView />
```

Even in allowed cases, prefer a CSS-based approach first. If the two trees share >50% of their markup, use CSS breakpoints instead.

#### Migration pattern for existing `useIsMobile()` style switching

```tsx
// BEFORE — JS layout switching
const isMobile = useIsMobile()
return (
  <div className={isMobile ? 'flex-col p-2' : 'flex-row p-6'}>
    {!isMobile && <Sidebar />}
    <Main />
  </div>
)

// AFTER — CSS breakpoints
return (
  <div className={cn('flex flex-col p-2 md:flex-row md:p-6')}>
    <div className="hidden md:block">
      <Sidebar />
    </div>
    <Main />
  </div>
)
```

---

### 3. Width Rules — No Unguarded Fixed Widths

#### Rule: Every pixel/rem width MUST have a mobile fallback

Any `w-[Xpx]`, `w-[Xrem]`, `w-XX` (Tailwind scale), `min-w-[X]`, or `max-w-[X]` on a **layout container** must either:

1. Start with `w-full` and constrain upward, OR
2. Use responsive prefixes at every relevant breakpoint

```tsx
// WRONG — fixed width, overflows on mobile
<div className="w-[500px]">
<div className="w-96">
<div className="min-w-[600px]">

// CORRECT — full width on mobile, constrained on larger screens
<div className="w-full md:max-w-md lg:max-w-lg">
<div className="w-full md:w-96">
<div className="w-full md:min-w-[600px]">  // min-w only kicks in on md+
```

#### Rule: `min-w-[X]` on panels/sidebars MUST be breakpoint-guarded

A `min-w-[600px]` with no breakpoint means the element **cannot shrink below 600px on any screen**, guaranteeing horizontal overflow on mobile.

```tsx
// WRONG — forces 600px minimum on all screens
<div className="w-[50%] min-w-[600px] max-w-[900px]">

// CORRECT — full width on mobile, constrained on desktop
<div className="w-full lg:w-[50%] lg:min-w-[600px] lg:max-w-[900px]">
```

#### Rule: No fixed widths over 300px without `w-full` base

Small internal elements (icons, avatars, color pickers in popovers) can use fixed widths. Layout containers cannot.

| Element                 | Fixed width OK?                 |
| ----------------------- | ------------------------------- |
| Icon / avatar / badge   | Yes                             |
| Color picker in popover | Yes                             |
| Tooltip / small popover | Yes (under 300px)               |
| Card in a grid          | No — use `w-full`               |
| Sidebar / panel         | No — use responsive             |
| Dialog / Sheet content  | No — see Section 8              |
| Page container          | No — use responsive             |
| Select trigger          | No — use `w-full` or responsive |

---

### 4. Grid Layouts — Always Responsive

#### Rule: Every `grid-cols-N` (where N > 1) MUST have breakpoint variants

```tsx
// WRONG
<div className="grid grid-cols-2 gap-4">
<div className="grid grid-cols-3 gap-4">
<div className="grid grid-cols-5 gap-4">

// CORRECT
<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
```

#### Exception: `grid-cols-N` inside a fixed-width popover/dropdown (under 300px)

Color pickers and small menus inside popovers with constrained width are acceptable:

```tsx
// OK — inside a w-[200px] popover
<div className="grid grid-cols-6 gap-1">
  {colors.map((c) => (
    <ColorSwatch key={c} />
  ))}
</div>
```

#### Auto-fit for variable item counts

```tsx
<div className="grid grid-cols-[repeat(auto-fit,minmax(18rem,1fr))] gap-4">
  {items.map((item) => (
    <ItemCard key={item.id} />
  ))}
</div>
```

---

### 5. Flexbox Patterns

#### Horizontal row — always specify gap and alignment

```tsx
<div className="flex items-center gap-2">
  <Item1 />
  <Item2 />
</div>
```

#### Vertical stack

```tsx
<div className="flex flex-col gap-4">
  <Item1 />
  <Item2 />
</div>
```

#### Space between (toolbars / headers)

```tsx
<div className="flex items-center justify-between">
  <h2 className="text-lg font-semibold md:text-xl">Title</h2>
  <Button variant="outline">Action</Button>
</div>
```

#### Responsive direction switch

```tsx
<div className="flex flex-col gap-4 md:flex-row">
  <div className="w-full shrink-0 md:w-[30%]">
    <Sidebar />
  </div>
  <div className="w-full md:w-[70%]">
    <MainContent />
  </div>
</div>
```

#### Rule: Multi-item flex rows MUST use `flex-wrap`

Any flex container that renders a dynamic list (`.map()`) **must** include `flex-wrap` unless it is an intentionally horizontally-scrollable container with `overflow-x-auto` AND `flex-shrink-0` on children.

```tsx
// WRONG — items overflow on narrow screens
<div className="flex gap-2">
  {tags.map(tag => <Badge key={tag.id}>{tag.label}</Badge>)}
</div>

// CORRECT — wraps gracefully
<div className="flex flex-wrap gap-2">
  {tags.map(tag => <Badge key={tag.id}>{tag.label}</Badge>)}
</div>

// ALSO CORRECT — intentional horizontal scroll
<div className="flex gap-2 overflow-x-auto">
  {cards.map(card => <Card key={card.id} className="flex-shrink-0 w-[280px]" />)}
</div>
```

#### Rule: `flex-1` children MUST have `min-h-0` (column) or `min-w-0` (row)

Without this, flex children default to `min-height: auto` / `min-width: auto` and will overflow their parent instead of shrinking.

```tsx
// WRONG — flex child won't shrink below content size
<div className="flex flex-col h-full">
  <Header />
  <div className="flex-1 overflow-auto">
    <Content />
  </div>
</div>

// CORRECT — min-h-0 allows shrinking
<div className="flex flex-col h-full">
  <Header />
  <div className="flex-1 min-h-0 overflow-auto">
    <Content />
  </div>
</div>
```

```tsx
// WRONG — text blows out flex row
<div className="flex items-center gap-2">
  <div className="flex-1">{longText}</div>
</div>

// CORRECT — min-w-0 + truncate
<div className="flex items-center gap-2">
  <div className="flex-1 min-w-0 truncate">{longText}</div>
</div>
```

#### Rule: Constrained scrollable layouts — the standard pattern

```tsx
<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
  <div className="min-h-0 flex-1">
    <ScrollArea className="h-full">{/* Scrollable content */}</ScrollArea>
  </div>
</div>
```

#### Rule: `overflow-auto` / `overflow-y-auto` MUST have a height constraint

An `overflow-auto` without a height boundary does nothing — the element just grows. Always pair with one of:

- Explicit height: `h-[400px]`, `max-h-[600px]`
- Flex constraint: `flex-1 min-h-0`
- Viewport: `h-screen`, `h-dvh`

```tsx
// WRONG — no height constraint, overflow has no effect
<div className="overflow-y-auto">
  <LongList />
</div>

// CORRECT
<div className="flex-1 min-h-0 overflow-y-auto">
  <LongList />
</div>

// ALSO CORRECT
<ScrollArea className="h-[400px]">
  <LongList />
</ScrollArea>
```

---

### 6. Responsive Typography — Standard Sizes

Use these responsive patterns for text. Never use `text-2xl`+ without a smaller mobile base.

| Element              | Pattern                                      |
| -------------------- | -------------------------------------------- |
| Page title           | `text-xl md:text-2xl lg:text-3xl font-bold`  |
| Section heading      | `text-lg md:text-xl font-semibold`           |
| Card title           | `text-base md:text-lg font-semibold`         |
| Body text            | `text-sm md:text-base`                       |
| Caption / helper     | `text-xs md:text-sm text-muted-foreground`   |
| Large display number | `text-2xl md:text-3xl lg:text-4xl font-bold` |

```tsx
// WRONG — text-3xl on mobile is too large
<h1 className="text-3xl font-bold">Dashboard</h1>

// CORRECT
<h1 className="text-xl md:text-2xl lg:text-3xl font-bold">Dashboard</h1>
```

---

### 7. Responsive Spacing — Standard Scales

#### Page-level padding

```tsx
// WRONG — px-8 is 32px on mobile, too wide
<div className="px-8 py-6">

// CORRECT
<div className="px-4 md:px-6 lg:px-8 py-4 md:py-6">
```

#### Standard spacing scale

| Context          | Pattern                |
| ---------------- | ---------------------- |
| Page wrapper     | `px-4 md:px-6 lg:px-8` |
| Page vertical    | `py-4 md:py-6`         |
| Section gap      | `gap-4 md:gap-6`       |
| Card internal    | `p-4 md:p-6`           |
| Tight list items | `gap-2 md:gap-3`       |
| Inline elements  | `gap-1.5 md:gap-2`     |

#### Responsive gap in grids

```tsx
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
```

---

### 8. Dialog, Sheet & Modal Sizing

#### Dialogs — always responsive

```tsx
// WRONG — fixed width
<DialogContent className="w-[720px]">
<DialogContent className="max-w-6xl">

// CORRECT — viewport-aware with mobile base
<DialogContent className="w-[95vw] sm:max-w-[400px] md:max-w-[600px]">
<DialogContent className="w-[95vw] max-w-6xl">
```

#### Sheets (side panels) — responsive width

```tsx
// WRONG — fixed pixel width
<SheetContent className="w-[500px]">
<SheetContent className="w-[1100px]">

// CORRECT — full on mobile, constrained on desktop
<SheetContent side="right" className="w-[calc(100vw-2rem)] sm:max-w-md lg:max-w-lg">
<SheetContent side="right" className="w-[calc(100vw-2rem)] sm:max-w-[540px] lg:max-w-[900px]">
```

#### Large content panels (proposal writers, preview panels)

```tsx
// WRONG
<div className="w-[50%] min-w-[600px] max-w-[900px]">

// CORRECT — stacks full-width on mobile, side panel on desktop
<div className="w-full lg:w-[50%] lg:min-w-[600px] lg:max-w-[900px]">
```

#### Dialogs with `calc()` viewport widths

```tsx
// WRONG — no mobile fallback
<DialogContent className="max-w-[calc(100vw-10rem)]">

// CORRECT — tighter margins on mobile
<DialogContent className="w-[95vw] md:max-w-[calc(100vw-5rem)] lg:max-w-[calc(100vw-10rem)]">
```

---

### 9. `min-h-[X]` and `min-w-[X]` — Must Be Responsive

Fixed minimum dimensions force excessive scrolling or horizontal overflow on mobile.

```tsx
// WRONG — 800px minimum on a phone is the entire viewport
<div className="min-h-[800px]">
<div className="min-w-[800px]">

// CORRECT
<div className="min-h-[400px] md:min-h-[600px] lg:min-h-[800px]">
<div className="min-w-full md:min-w-[800px]">
```

---

### 10. `hidden` — Always Pair with Responsive Restore

Every `hidden` class used for responsive layout **must** have a breakpoint restore (`md:block`, `md:flex`, `lg:block`, etc.) unless the element is:

- **Unconditionally hidden** (e.g., `sr-only` for screen readers)
- **Controlled by JavaScript** (e.g., `{isOpen && <div>...</div>}` where visibility is toggled by state, not CSS)

```tsx
// WRONG — hidden forever, probably a bug
<div className="hidden">
  <Sidebar />
</div>

// CORRECT — hidden on mobile, visible on desktop
<div className="hidden md:block">
  <Sidebar />
</div>

// CORRECT — visible on mobile, hidden on desktop
<div className="md:hidden">
  <MobileNav />
</div>

// OK — unconditionally hidden for screen readers
<span className="sr-only">Screen reader text</span>

// OK — JS-controlled visibility, hidden is just the default state
{isOpen && (
  <div className="...">
    <PanelContent />
  </div>
)}
```

#### Show/hide with alternative content

```tsx
// Full label on desktop, icon-only on mobile
<span className="hidden md:inline">Export to CSV</span>
<DownloadIcon className="md:hidden h-4 w-4" />
```

---

### 11. Scroll Containers — Use `ScrollArea`

Prefer shadcn `<ScrollArea>` over raw `overflow-auto` for styled, consistent scrollbars. See `frontend-component-design` for general shadcn component rules.

```tsx
// WRONG
<div className="overflow-auto h-[400px]">
  <Content />
</div>

// CORRECT
<ScrollArea className="h-[400px]">
  <Content />
</ScrollArea>
```

---

### 12. Color & Styling — Follow Design Token Rules

**Do not use raw hex, rgb, or Tailwind color names** (e.g., `text-gray-500`) for semantic colors. Use CSS variable-based design tokens.

See `frontend-component-design` for the full token reference, `cn()` usage rules, and CVA variant patterns. Key layout-relevant tokens:

| Token                   | Usage                   |
| ----------------------- | ----------------------- |
| `text-foreground`       | Primary text            |
| `text-muted-foreground` | Secondary / helper text |
| `bg-background`         | Page background         |
| `bg-muted`              | Muted sections          |
| `border-input`          | Standard borders        |
| `border-border`         | Layout dividers         |

For styled containers, prefer shadcn `<Card>` over manually applying `border`, `rounded`, `shadow`, and `padding` to a raw `<div>`. See the Dual API and Product-Aware Wrappers sections in `frontend-component-design`.

---

### 13. Common Layout Patterns

#### Page container

For pages that follow the standard heading + actions + content pattern, use the `PageShell` scaffold (see `frontend-component-design`). For simpler wrappers:

```tsx
<div className="px-4 pt-4 md:px-6 lg:px-8">
  <PageContent />
</div>
```

#### Two-panel layout

```tsx
<div className="flex flex-col gap-4 md:flex-row">
  <div className="w-full shrink-0 md:w-[30%]">
    <LegendPanel />
  </div>
  <div className="w-full md:w-[70%]">
    <div className="border-border-muted min-h-[300px] rounded-md border border-dashed p-4 md:min-h-[500px]">
      <MainContent />
    </div>
  </div>
</div>
```

#### Full-height layout with sidebar

```tsx
<div className="flex h-screen w-full flex-col overflow-hidden">
  <div className="flex min-h-0 flex-1 overflow-hidden">
    <div className="hidden md:block">
      <Sidebar />
    </div>
    <main className="min-w-0 flex-1 overflow-hidden">
      <div className="h-full w-full overflow-auto pb-16 md:pb-0">{children}</div>
    </main>
  </div>
  <div className="md:hidden">
    <MobileFooter />
  </div>
</div>
```

#### Badge / filter row

```tsx
<div className="flex flex-wrap gap-2">
  {filters.map((filter) => (
    <Badge key={filter.id} variant="outline">
      {filter.label}
    </Badge>
  ))}
</div>
```

#### Horizontally scrollable card row

```tsx
<div className="flex gap-4 overflow-x-auto pb-2">
  {cards.map((card) => (
    <Card key={card.id} className="w-[280px] flex-shrink-0 sm:w-[320px]">
      <CardContent>{card.title}</CardContent>
    </Card>
  ))}
</div>
```

#### Select triggers in toolbars

```tsx
// WRONG — fixed widths overflow on mobile
<div className="flex gap-2">
  <SelectTrigger className="w-[280px]">...</SelectTrigger>
  <SelectTrigger className="w-[200px]">...</SelectTrigger>
</div>

// CORRECT — flexible on mobile, constrained on desktop
<div className="flex flex-wrap gap-2">
  <SelectTrigger className="w-full sm:w-[200px] md:w-[280px]">...</SelectTrigger>
  <SelectTrigger className="w-full sm:w-[150px] md:w-[200px]">...</SelectTrigger>
</div>
```

#### Kanban / pipeline columns

```tsx
// WRONG — fixed column width on all screens
<div className="max-w-[400px] min-w-[400px]">

// CORRECT — narrower on mobile
<div className="min-w-[280px] max-w-[320px] md:min-w-[350px] md:max-w-[400px]">
```

#### Chart containers

```tsx
// WRONG — fixed width chart
<div className="w-[450px]">
  <Chart />
</div>

// CORRECT — responsive chart container
<div className="w-full max-w-[450px]">
  <Chart />
</div>
```

---

### 14. Complete Anti-Pattern Reference

Every pattern on the left is **banned**. Use the right column instead.

| Banned Pattern                                | Use Instead                                          | Why                            |
| --------------------------------------------- | ---------------------------------------------------- | ------------------------------ |
| `grid-cols-N` (N>1) without breakpoints       | `grid-cols-1 sm:grid-cols-2 lg:grid-cols-N`          | Overflows on mobile            |
| `w-[Xpx]` (X>300) on layout containers        | `w-full md:max-w-[Xpx]`                              | Overflows on mobile            |
| `w-96` / `w-80` etc. on layout containers     | `w-full md:w-96`                                     | Overflows on mobile            |
| `min-w-[X]` without breakpoint guard          | `md:min-w-[X]` (with `w-full` base)                  | Forces overflow on all screens |
| `min-h-[800px]` without breakpoint            | `min-h-[400px] md:min-h-[800px]`                     | Excessive scroll on mobile     |
| `min-w-[800px]` without breakpoint            | `min-w-full md:min-w-[800px]`                        | Horizontal overflow on mobile  |
| `flex` without `flex-wrap` on `.map()` rows   | `flex flex-wrap`                                     | Items overflow                 |
| `flex-1` without `min-h-0` in column          | `flex-1 min-h-0`                                     | Prevents shrinking             |
| `flex-1` without `min-w-0` in row             | `flex-1 min-w-0`                                     | Text/content overflow          |
| `overflow-auto` without height constraint     | Add `h-[X]`, `max-h-[X]`, or `flex-1 min-h-0`        | Scroll has no effect           |
| `text-2xl`+ without responsive base           | `text-lg md:text-2xl`                                | Too large on mobile            |
| `px-8`+ on page containers without responsive | `px-4 md:px-6 lg:px-8`                               | Too wide on mobile             |
| `hidden` without breakpoint restore (layout)  | `hidden md:block`                                    | Element lost forever           |
| `useIsMobile()` for style switching           | CSS breakpoint classes                               | JS flash, no SSR               |
| `whitespace-nowrap` without `truncate`        | `truncate` (includes nowrap + overflow)              | Text overflows container       |
| Raw `overflow-auto` for scrollable areas      | `<ScrollArea>`                                       | Inconsistent scrollbars        |
| Raw hex/color names for semantic colors       | Design tokens (see `frontend-component-design`)      | Breaks theming                 |
| `<div>` with manual border/padding/shadow     | `<Card>` component (see `frontend-component-design`) | Inconsistent styling           |
| `max-w-[calc(100vw-Xrem)]` without breakpoint | `w-[95vw] md:max-w-[calc(100vw-Xrem)]`               | No mobile fallback             |
| `w-[50%]` + `min-w-[600px]` (unguarded)       | `w-full lg:w-[50%] lg:min-w-[600px]`                 | min-w forces overflow          |
| Fixed `w-[Xpx]` on `SheetContent`             | `w-[calc(100vw-2rem)] sm:max-w-[X]`                  | Sheet overflows mobile         |
| Fixed `w-[Xpx]` on `DialogContent`            | `w-[95vw] sm:max-w-[X]`                              | Dialog overflows mobile        |
| `className={isMobile ? "..." : "..."}`        | `cn("base-mobile md:desktop-override")`              | JS re-render, flash            |
