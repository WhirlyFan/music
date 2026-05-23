---
name: frontend-motion
description: Motion tokens and CSS-only animation patterns for the Next.js frontend. No animation library. Use when adding transitions, sliding indicators, mount/unmount effects, or page-level view transitions.
---

# Frontend Motion

Two easings, three durations, all in CSS. No `framer-motion` / `motion`. Set up in ENG-2401, modeled on [Frigade's two-curve approach](https://frigade.com/blog/two-easing-curves-no-animation-library).

## Tokens (`frontend/src/app/globals.css` `@theme`)

| Token | Value | Use for |
|---|---|---|
| `--ease-entrance` | `cubic-bezier(0.23, 1, 0.32, 1)` | Mounts, content reveals, slide+fade |
| `--ease-interaction` | `cubic-bezier(0.32, 0.72, 0, 1)` | Hover, press, dropdowns, sliding indicators |
| `--duration-fast` | `160ms` | Hover, focus, button press |
| `--duration-base` | `220ms` | Tab indicators, dropdowns, popovers, tooltips, Radix `slide*AndFade` |
| `--duration-content` | `480ms` | Large content reveals — hero banners, full-panel slide-ins (no current consumers; reserved) |

`@media (prefers-reduced-motion: reduce)` zeros the duration tokens globally. Anything using `var(--duration-*)` is automatically compliant — don't write per-component reduced-motion blocks.

## Tailwind v4 quirk

`--ease-*` is a Tailwind namespace → `ease-interaction` is a real utility.
`--duration-*` is **not** a namespace → `duration-base` does **not** exist. Use the CSS-variable shorthand:

```tsx
// ✅
<div className="transition-[width,left] duration-(--duration-base) ease-interaction" />
// ✅ inline
<div style={{ transition: 'all var(--duration-base) var(--ease-interaction)' }} />
// ❌ silently produces no class
<div className="duration-base" />
```

In `@theme` keyframes, just use `var(--duration-content) var(--ease-entrance)`.

## Rules

1. **No `cubic-bezier(...)` literals.** Use the tokens. The 3 inline-bezier sites in ENG-2401 were the spec-default `ease` pasted as a no-op.
2. **No `duration-150` / `duration-300` for new motion.** Pick a token. Existing one-off `transition-colors duration-150` in `components/ui/` are fine — only fix conflicts.
3. **No `framer-motion` or `motion` (`motion/react`).** Both deps are banned. CSS covers entrance (`@starting-style`), exit (`transition-behavior: allow-discrete` or React state + setTimeout), shared elements (`<ViewTransition>`), and indicators (CSS transitions). If you genuinely need drag/gesture/spring physics, get sign-off in the PR.
4. **Prefer `transform` / `opacity` over `width` / `left` / `top`.** Only the former animate on the compositor. Existing repo indicators use `left`/`width` because the offset is measured per render — that's a known tradeoff, not the pattern for new code.
5. **`will-change` is a last resort.** Don't put it in stylesheets. Add via JS just before a measured-jank transition, remove on `transitionend`.

## Patterns

### Sliding indicator (active-tab underline, toggle blob)

```tsx
// Gate the transition until first measurement so it doesn't slide in from (0,0)
<div
  className={cn(
    'absolute h-0.5 bg-foreground',
    width > 0 && 'transition-[width,left] duration-(--duration-base) ease-interaction',
  )}
  style={{ width, left }}
/>
```

For inline `style.transition` (when set from a measurement effect): `transition: initialized ? 'all var(--duration-base) var(--ease-interaction)' : 'none'`.

Examples in repo: `components/ui/sliding-badge-tabs.tsx`, `WorkspacesPanel.tsx`, `ForecastTabHeader.tsx`, `PipelineDateTabToggle.tsx`, `DeepResearchInputBar.tsx`.

### Entrance on mount — `@starting-style`

```css
.toast {
  opacity: 1;
  transition: opacity var(--duration-content) var(--ease-entrance);
  @starting-style { opacity: 0; }
}
```

Pairs with `transition-behavior: allow-discrete` if you also transition `display`. For React-driven exits (no `<AnimatePresence>` available), set `isExiting`, wait `--duration-base`, then unmount.

### Page / shared-element transitions — Next.js `<ViewTransition>`

Next.js 16 has native View Transitions. Enable once:

```ts
// next.config.ts
const nextConfig: NextConfig = { experimental: { viewTransition: true } };
```

Common patterns ([guide](https://nextjs.org/docs/app/guides/view-transitions)):
- **Shared morph**: same `name="photo-${id}"` on the source and destination element
- **Suspense reveal**: `<ViewTransition exit="..."><Skeleton/></ViewTransition>` + `<ViewTransition enter="..." default="none">` on resolved content
- **Directional slide**: `<Link transitionTypes={['nav-forward']} />` + map types in `<ViewTransition enter={{ 'nav-forward': '...', default: 'none' }} />`. ~60px offset is the sweet spot.
- **Same-route crossfade**: `<ViewTransition key={slug} share="auto" enter="auto" default="none">`

**Reduced motion for view transitions needs its own override** — pseudo-elements don't read our duration tokens:

```css
@media (prefers-reduced-motion: reduce) {
  ::view-transition-old(*),
  ::view-transition-new(*),
  ::view-transition-group(*) {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
  }
}
```

Don't use `<ViewTransition>` for hover/press feedback — it's for route or state-change transitions.

## When this system isn't enough

The token set is intentionally minimal. If a future feature needs:
- **An "expressive" tier** (slow, attention-grabbing marketing motion) — add `--ease-expressive` + `--duration-expressive` (cf. [IBM Carbon's productive/expressive split](https://carbondesignsystem.com/elements/motion/overview/))
- **Distance-aware durations** (longer moves use longer durations) — Material 3 / View Transitions handle this; don't try to encode it in tokens
- **Drag, gesture, or physics-spring** — bring back `motion` (the renamed `framer-motion`) for that feature only, with sign-off

## References

- [Frigade — Two easing curves, no animation library](https://frigade.com/blog/two-easing-curves-no-animation-library) (origin of our curve values)
- [Next.js — View Transitions guide](https://nextjs.org/docs/app/guides/view-transitions), [`viewTransition` config](https://nextjs.org/docs/app/api-reference/config/next-config-js/viewTransition)
- [React — `<ViewTransition>`](https://react.dev/reference/react/ViewTransition)
- MDN — [`@starting-style`](https://developer.mozilla.org/en-US/docs/Web/CSS/@starting-style), [`transition-behavior`](https://developer.mozilla.org/en-US/docs/Web/CSS/transition-behavior), [`will-change`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/will-change)
- [web.dev — `prefers-reduced-motion`](https://web.dev/articles/prefers-reduced-motion); [CSS-Tricks — No motion isn't always reduced motion](https://css-tricks.com/nuking-motion-with-prefers-reduced-motion/) (disable non-essential, not all)
- [Tailwind v4 — `duration-(<custom-property>)`](https://tailwindcss.com/docs/transition-duration), [theme namespaces](https://tailwindcss.com/docs/theme)
- Adjacent systems for reference: [Material 3 motion](https://m3.material.io/styles/motion/easing-and-duration/tokens-specs), [IBM Carbon motion](https://carbondesignsystem.com/elements/motion/overview/), [Shopify Polaris motion](https://polaris-react.shopify.com/tokens/motion)
