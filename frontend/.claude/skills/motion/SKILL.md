---
name: frontend-motion
description: Motion & interaction design for the music app (Vite + Tailwind v4, no animation library). Functional-not-decorative philosophy, HeroUI-aligned cadence (250ms ease), the project's easing/keyframe tokens, the Button ripple + press + shadow recipe, and prefers-reduced-motion. Use when adding ANY transition, animation, hover/press feedback, or styling a button/control.
---

# Frontend Motion

CSS-first motion for a music player. **No `framer-motion` / `motion`** — microinteractions are pure CSS (GPU `transform`/`opacity`). Tokens live in `frontend/src/index.css` (`@theme` + `@keyframes`). The bar to clear is HeroUI's feel, not a marketing site's.

## The one rule: functional, not decorative

Every animation must **communicate state or give feedback for a user action**. If it just moves on its own, cut it. This is the lesson the whole motion system was tuned around — apply the test before adding anything:

| Pattern | Verdict | Why |
| --- | --- | --- |
| Press / scale-down on click | ✅ keep | Tactile feedback (HeroUI's *default* button behavior) |
| Ripple from the press point | ✅ keep | Feedback tied to where you acted |
| Hover **color/opacity** change | ✅ keep | Communicates "interactive / targeted" |
| Entrance slide/fade on mount | ✅ keep | Orients you to new content |
| State-driven loops (e.g. the now-playing equalizer) | ✅ keep | Reflects real state |
| Hover **lift** (`-translate-y`), hover **glow** | ❌ cut | Movement that says nothing; reads as Dribbble, not product |
| Icon **pop/bounce** on a simple swap (play↔pause) | ❌ cut | Gimmick; the swap needs no animation |
| `duration-150` for interactive transitions | ❌ avoid | Too fast → feels cheap. Use 250ms (see cadence) |

Mature products (Spotify, Linear, Stripe, HeroUI) keep chrome quiet: color + press + soft depth, nothing levitating. **The music is the star.** Restraint is the design.

## Cadence (HeroUI-matched)

HeroUI's composite transitions are **250ms with `ease`** ([their theme source](https://github.com/heroui-inc/heroui)). That's our interactive baseline — 150ms felt cheap and got fixed. Entrances are a touch longer.

- **Interactive (hover/press/color):** `duration-[250ms] ease`
- **Entrances (mount reveals):** ~200–280ms on `--ease-out-quint`
- **Ripple:** `0.8s ease`

## Tokens (`src/index.css`)

Tailwind v4 turns `--ease-*` into `ease-*` utilities and `--animate-*` into `animate-*` utilities (keyframes are defined right below the `@theme` block).

| Token | Value | Use for |
| --- | --- | --- |
| `--ease-standard` | `cubic-bezier(0.4, 0, 0.2, 1)` | General UI state changes (Material standard) |
| `--ease-out-quint` | `cubic-bezier(0.22, 1, 0.36, 1)` | Snappy entrances (fast in, gentle stop) |
| `--ease-out-back` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Slight overshoot — use sparingly |
| `animate-fade-in` | `fade-in 0.2s out-quint` | Opacity-in |
| `animate-slide-up` | `slide-up 0.28s out-quint` | Panel/bar entrance (translateY+fade) |
| `animate-pop-in` | `pop-in 0.18s out-back` | Scale-in (reserved; use rarely) |
| `animate-equalize` | `equalize 0.9s standard infinite` | Now-playing equalizer bars |
| `animate-ripple` | `ripple 0.8s ease forwards` | Button press ripple |

**`--ease-*` are real utilities** (`ease-standard`). Durations are **not** a Tailwind namespace — write `duration-[250ms]` (arbitrary), not `duration-250`.

## Accessibility — already handled globally

`src/index.css` has one `@media (prefers-reduced-motion: reduce)` block that collapses **all** animation/transition durations to ~0.01ms. So:

- Don't write per-component reduced-motion blocks.
- Gate *movement* (transforms) behind `motion-safe:` so reduce-motion users get color/opacity only, no motion (e.g. `motion-safe:active:scale-[0.97]`).
- JS-spawned animations (the ripple) still self-clean under reduce-motion because the global guard makes `animationend` fire immediately — don't gate ripple spawning on `matchMedia`.

## The Button recipe (`src/components/ui/button.tsx`)

The canonical example of all of the above. New interactive controls should match it:

- **Radius:** `rounded-xl` (12px — HeroUI medium); small size drops to `rounded-lg`.
- **Transitions:** `transition-[transform,color,background-color,opacity] duration-[250ms] ease motion-reduce:transition-none`.
- **Press:** `motion-safe:active:scale-[0.97]`.
- **Ripple:** captured at the pointer-down point, rendered as a `bg-current` circle with `animate-ripple` inside an `overflow-hidden` button, removed on `onAnimationEnd`. `bg-current` makes it adapt per variant.
- **Variants:** `default | outline | ghost | destructive | shadow`. Use **`shadow`** for a hero/primary action — it's a *static* soft colored shadow (`shadow-lg shadow-primary/40`) + `hover:opacity-90` (HeroUI's opacity-hover). Static depth is fine; a hover-*lift* is not.

Don't hand-roll button styling elsewhere — use `<Button variant=... size=...>` so the ripple, press, cadence, and radius come for free.

## Patterns

**Entrance (mount):** add `motion-safe:animate-slide-up` (bars/panels) or `motion-safe:animate-fade-in`. CSS keyframes run once on mount and won't replay on re-render, so they're safe on components that re-render from query updates.

**State loop (equalizer):** decorative-but-functional flourish that reflects real state — see `Equalizer` in `now-playing-bar.tsx`. Three `animate-equalize` bars with staggered `animationDelay`, `origin-bottom`, rendered only while `is_playing`.

**Row highlight / hover:** `transition-colors duration-150` is acceptable for pure color (the one place a faster duration reads fine); the current row gets a `bg-muted` + a `▶` marker rather than motion.

**Overlays (dialogs, sheets, dropdowns) — the global enter/exit system.** Radix
keeps the node mounted while `data-state="closed"` until the exit animation ends,
so we drive enter/exit off `data-[state]` with our tokens (entrances ease-out,
exits a touch quicker — Frigade's two-curve model):

| Surface | open | close |
| --- | --- | --- |
| Backdrop / dropdown (opacity only — popper-positioned, don't animate transform) | `data-[state=open]:animate-fade-in` | `data-[state=closed]:animate-fade-out` |
| Centered dialog content (fade + zoom, keeps the −50% centering transform) | `data-[state=open]:animate-dialog-in` | `data-[state=closed]:animate-dialog-out` |
| Bottom sheet (slide up — for a future Sheet) | `data-[state=open]:animate-sheet-up-in` | `data-[state=closed]:animate-sheet-up-out` |

Wired into `components/ui/alert-dialog.tsx` (covers `confirm()` + `promptText()`)
and `dropdown-menu.tsx`. The `*-out` tokens use `forwards` so the end frame holds
until Radix unmounts.

> **⚠️ shadcn animation classes are NOT available here.** We don't install
> `tailwindcss-animate` / `tw-animate-css`, so the classes shadcn ships
> (`animate-in`, `animate-out`, `fade-in-0`, `zoom-in-95`, `slide-in-from-*`) are
> **no-ops** — a pasted component will *silently not animate*. When adding a
> shadcn component, **translate those classes to our `data-[state]:animate-*`
> tokens above.** (This is the deliberate trade-off for keeping every animation
> on our own curves — see "When CSS isn't enough".)

## When CSS isn't enough

The system is deliberately minimal. Reach for the **`motion`** library (renamed `framer-motion`) **only** for: list enter/exit (`AnimatePresence`), drag/reorder gestures, or spring physics — and only for that feature, called out in the PR. Everything else (hover, press, ripple, mount entrances, loops) stays CSS.

## References

- [HeroUI Button](https://www.heroui.com/docs/components/button) + [v2](https://v2.heroui.com/) — the cadence/ripple/shadow reference; 250ms `ease`, scale-highlight/scale-ripple feedback
- [Josh W. Comeau — CSS transitions](https://www.joshwcomeau.com/animation/css-transitions/), [easings.net](https://easings.net/)
- [web.dev — prefers-reduced-motion](https://web.dev/articles/prefers-reduced-motion); disable *non-essential* motion, keep feedback
- [Tailwind v4 — transitions](https://tailwindcss.com/docs/transition-property) & [theme namespaces](https://tailwindcss.com/docs/theme) (`--ease-*` → utility; durations are not)
