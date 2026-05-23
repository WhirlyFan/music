---
name: frontend-overlays
description: Imperative `overlay.open()` pattern for viewport-rendered ephemeral overlays (modals, confirms, drawers, sheets, command palettes), backed by a private Zustand store and a renderer component. Eliminates `useState` open flags, prop-drilled `onClose` handlers, and ad-hoc modal stores. The trigger is imperative; the JSX returned from the controller is declarative. Use when designing or refactoring any modal-family overlay triggered programmatically. Does NOT cover anchored popups (Tooltip, Popover, Dropdown — use Radix) or toasts (use sonner).
---
# Overlays

An imperative `overlay.open()` API for viewport-rendered ephemeral overlays — modals, confirms, drawers, sheets, command palettes. The call site is imperative; the JSX returned from the controller is declarative.

## Pattern

Imperative trigger + Zustand store + renderer component. No Provider, no Context.

- One `<OverlayRenderer />` mounted as a sibling of `{children}` at the app root.
- `overlay.open((props) => <UI />)` from anywhere — event handlers, mutations, async flows.
- The render function receives `{ isOpen, close, unmount, overlayId }` and returns standard JSX.
- `overlay.openAsync<T>()` returns a Promise that resolves when the UI calls `close(value)`.

The store is private to the module. Consumers only see `overlay.*` and `<OverlayRenderer />`.

## Scope

This pattern covers **viewport-rendered overlays** — UI rendered at a fixed location on the screen. It does NOT cover **anchored popups** (positioned relative to a trigger element) or toasts.

| Surface | Use | Why |
|---|---|---|
| Modal | this pattern + shadcn `<Dialog>` | Viewport-centered, ephemeral, often Promise-returning |
| Confirm / alert | this pattern + shadcn `<AlertDialog>` (`confirm()` helper) | Same as modal |
| Drawer / sheet | this pattern + shadcn `<Sheet>` | Viewport-edge, ephemeral |
| Command palette | this pattern + `<CommandDialog>` | Viewport-rendered |
| Tooltip | shadcn `<Tooltip>` (Radix) | Anchored to trigger element — needs Floating UI positioning |
| Popover | shadcn `<Popover>` (Radix) | Anchored — same |
| Dropdown menu | shadcn `<DropdownMenu>` (Radix) | Anchored + roving tabindex + type-ahead |
| Context menu | shadcn `<ContextMenu>` (Radix) | Anchored + right-click capture |
| Toast | `sonner` global `toast()` API | Already imperative-global; specialized for auto-dismiss + stacking |

The dividing line: **does the overlay need to position itself relative to a trigger element?** If yes → Radix primitive. If it's viewport-relative → this pattern.

## Decision tree

1. Anchored to a trigger element (tooltip, popover, dropdown)? → **Radix primitive**
2. Toast surface? → **sonner**
3. Survives refresh / linkable? → **nuqs**
4. Modal with one obvious nearby trigger and no Promise return? → **compound `<Dialog><DialogTrigger asChild />`**
5. Triggered from async flows, multiple callers, or needs a Promise return? → **this pattern**
6. Scoped to one component, no async? → **`useState`**

## Architecture

```
frontend/lib/overlay/
  store.ts       # private Zustand store
  overlay.ts     # public imperative API (overlay.open, openAsync, close, unmount, closeAll)
  renderer.tsx   # <OverlayRenderer /> — subscribes to the store, renders active overlays
  confirm.tsx    # Promise-based confirm() helper wrapping AlertDialog
  index.ts       # exports overlay, OverlayRenderer, confirm, types
```

Lifecycle:

```
overlay.open()           → store.add (isOpen=false, mounted)
  rAF                    → store.open  (isOpen=true)        → enter animation
overlay.close() / props.close()  → store.close (isOpen=false) → exit animation
  onCloseAutoFocus       → props.unmount → store.remove → gone
```

Two-phase open is required so Radix Dialog detects the `false → true` transition and runs the enter animation. Two-phase close (close → animate → unmount) preserves the exit animation.

Use Radix's `onCloseAutoFocus` (not `onAnimationEnd`) on `DialogContent` / `AlertDialogContent` / `SheetContent` to fire `unmount`. It runs after Radix's internal close animation and isn't triggered by child-element animations. shadcn primitives spread `...props` to the Radix primitive, so it passes through.

## Implementation

Code lives in `frontend/lib/overlay/` (5 files, ~120 LOC). Read the source for canonical truth.

**Public API** (`import { ... } from '@/lib/overlay'`):

| Export | Purpose |
| --- | --- |
| `overlay.open(controller, opts?)` | Fire-and-forget. Returns the overlay id. |
| `overlay.openAsync<T>(controller, opts?)` | `Promise<T \| null>`. Resolves with `value` when the dialog calls `close(value)`; resolves with `null` if `closeAll` / `unmount` dismisses it first. Never rejects. |
| `overlay.close(id)` / `overlay.unmount(id)` / `overlay.closeAll()` | Imperative dismissal. |
| `<OverlayRenderer />` | Singleton renderer. Mount once at root. |
| `confirm({ title, description?, confirmLabel, destructive? })` | `Promise<boolean>`. |
| Types | `OverlayProps`, `OverlayAsyncProps<T>`, `OverlayController`, `OverlayAsyncController<T>` |

**Contract notes** (things that aren't obvious from reading the code):

- The store is wrapped in Zustand `devtools` middleware as `overlay-store`. Five labeled actions appear in Redux DevTools: `overlay/add`, `overlay/open`, `overlay/close`, `overlay/remove`, `overlay/closeAll`. The store is module-private — `useOverlayStore` is intentionally not exported.
- `<OverlayRenderer />` subscribes via four atomic Zustand selectors (`order`, `items`, `close`, `remove`). Don't add `useShallow` — it's for selectors that build new objects per call; atomic picks don't need it. Each selector re-runs only when its slice changes.
- `openAsync` subscribes to the store internally to handle programmatic dismissal. Radix only fires `onOpenChange` for user-initiated closes (Esc/backdrop/close button); `closeAll()` flips `isOpen: false` without firing it, and `unmount(id)` removes the item directly. The subscribe resolves the Promise with `null` whenever the overlay is removed without `close(value)`. Result: callers never need try/catch — `T | null` is the universal result type, `null` means "user dismissed or system cancelled, do nothing." Dialogs that encounter internal errors should handle them in-place (toast, retry) rather than propagating to the caller.
- Two-phase open via `requestAnimationFrame` is required so Radix detects the `false → true` transition and runs the enter animation. Two-phase close (close → animate → unmount via `onCloseAutoFocus`) preserves the exit animation.

### Mounting

One `<OverlayRenderer />` at the app root, as a sibling of `{children}` — not a wrapper. Overlays inherit Context from everything above this point in the tree. In this codebase it lives in `frontend/src/app/layout.tsx` as a sibling of `<Toaster />`.

## Usage

### Modal triggered from a button

```tsx
import { overlay } from '@/lib/overlay';

<Button
  onClick={() =>
    overlay.open(({ isOpen, close, unmount }) => (
      <Dialog open={isOpen} onOpenChange={(o) => !o && close()}>
        <DialogContent onCloseAutoFocus={() => !isOpen && unmount()}>
          <EditForm id={id} onSaved={close} />
        </DialogContent>
      </Dialog>
    ))
  }
>
  Edit
</Button>
```

`EditForm` calls `useQuery` and `useMutation` directly — server data still flows through React Query.

### Promise-based confirm

```tsx
import { confirm } from '@/lib/overlay';

async function handleDelete(id: string) {
  const ok = await confirm({
    title: 'Delete proposal?',
    description: 'This cannot be undone.',
    confirmLabel: 'Yes, delete',
    destructive: true,
  });
  if (!ok) return;
  await deleteMutation.mutateAsync(id);
}
```

`confirmLabel` is **required** — see `frontend-ux-copywriting`. Generic labels like "Confirm" or "Yes" are flagged; use action-specific verb phrases ("Yes, delete", "Save changes", "Remove member"). Title should be a question naming the specific action ("Delete proposal?" not "Confirm action").

**`confirm()` is for irreversible destructive actions only.** For reversible actions, "Done. Undo?" via `sonner.toast` is better UX than blocking the user with a modal — see `frontend-ux-copywriting`. Reach for `confirm()` when the action genuinely cannot be undone (delete account, leave workspace, discard unsaved work) — not as a default "are you sure?" reflex.

### Form modal returning a typed value

```tsx
const result = await overlay.openAsync<{ name: string; email: string } | null>(
  ({ isOpen, close, unmount }) => (
    <Dialog open={isOpen} onOpenChange={(o) => !o && close(null)}>
      <DialogContent onCloseAutoFocus={() => !isOpen && unmount()}>
        <InviteForm
          onSubmit={(values) => close(values)}
          onCancel={() => close(null)}
        />
      </DialogContent>
    </Dialog>
  )
);
if (!result) return;
await invite.mutateAsync(result);
```

## Forms inside overlays

TanStack Form + Zod owns field state and validation; the overlay store owns mount/open/close. The form calls `close(value)` to resolve the Promise (see the typed-value example above).

Don't mirror form values into the overlay store. For multi-step wizards, use one `useForm` instance for the whole flow — not Zustand.

## Closure discipline

The controller passed to `overlay.open` is a JSX-returning function captured **at call time**. Anything it closes over is frozen at that moment.

This only matters when **all three** are true:

1. The captured value is a non-primitive (object reference), not a string/number.
2. The underlying data can change while the dialog is open (broadcast invalidation, optimistic update, mutation elsewhere).
3. The dialog visibly depends on the latest value.

Most natural usage is fine. `overlay.open((props) => <Dialog {...props} teamId={teamId} teamName={team.name} />)` captures two strings — neither will mutate during the dialog's life. Don't refactor for hypothetical staleness.

The two patterns that are actually risky:

**Capturing whole objects whose fields update**

```tsx
// ✗ If `team.permissions` updates via broadcast while the dialog is open,
//   the dialog still reads the stale `team` reference.
overlay.open((props) => <PermissionsDialog {...props} team={team} />);

// ✓ Pass the id; read live state inside the dialog.
overlay.open((props) => <PermissionsDialog {...props} teamId={team.id} />);

function PermissionsDialog({ teamId, ... }) {
  const { data: team } = useTeam(teamId);  // refetches on broadcast
}
```

**Capturing mutation references**

```tsx
// ✗ Captures `mutation` at open time. If the parent unmounts before the
//   user clicks, you call a stale mutation. `isPending` isn't visible.
const mutation = useDeleteTeam(teamId);
overlay.open(({ close }) => <Dialog><Button onClick={() => mutation.mutate()}>Delete</Button></Dialog>);

// ✓ Dialog owns its mutation lifecycle.
overlay.openAsync<boolean>((props) => <DeleteTeamDialog {...props} teamId={teamId} />);
```

**Quick test:** if every value you're closing over is `string | number | boolean | null` AND every callback is bound to something stable (the router, a top-level handler), you're fine. If you're closing over an object that comes from `useQuery` / a Zustand selector / a parent's state, pass the ID and fetch inside the dialog instead.

The dialog is rendered from `<OverlayRenderer />` at the app root, not from where you wrote `overlay.open(...)`, so closure-staleness bugs won't show up via React DevTools or prop-walking — they look like "the dialog is showing wrong data." That's the failure mode to recognize in QA.

## Migration

Existing dialogs use `useState` flags + payload state lifted to the parent + `<Dialog open onOpenChange>` props. Don't rewrite all of them at once.

Rules of engagement:
1. **New ephemeral overlays use `overlay.open`** by default.
2. **When touching an existing dialog**, refactor as part of that change.
3. **Confirm dialogs get the `confirm()` helper immediately** — pure win, no migration cost.

Refactor shape: move `useState` for form input and mutation state into the dialog component itself. The dialog gains `OverlayProps` instead of `open` / `onOpenChange`. The caller becomes one `overlay.open()` or `await overlay.openAsync()` call. Programmatic dismissal (`closeAll`, `unmount`) resolves the Promise with `null`, so a falsy check is enough — no try/catch.

## Accessibility

Radix Dialog / AlertDialog / Sheet handle the heavy lifting — focus trap on open, focus restoration to the trigger on close, Esc-to-close, ARIA roles (`dialog` / `alertdialog`), `aria-modal="true"`, scroll lock. **Don't override these.** Concretely:

- Always include `<DialogTitle>` / `<AlertDialogTitle>` / `<SheetTitle>`. Radix throws a runtime warning otherwise. If the title is visual-only-not-needed, wrap it in `<VisuallyHidden>`.
- Don't capture `keydown` at the controller level to override Esc — let Radix handle it via `onOpenChange(false)`.
- Don't call `e.preventDefault()` inside `onCloseAutoFocus` — that cancels Radix's focus restoration.
- For confirms, use `<AlertDialog>` (role=`alertdialog`), not `<Dialog>` — screen readers announce them more assertively.
- See `frontend-accessibility` for the broader ARIA / keyboard / focus-management rules.

## Sizing

`<DialogContent>` and `<SheetContent>` sizing follows `frontend-ux-layouts` Section 8 — never hardcode pixel widths, always responsive (`w-[95vw] max-w-...`).

## Rules

1. One `<OverlayRenderer />` at the app root. The store is module-level; multiple renderers re-render every overlay in each tree.
2. Keep `useOverlayStore` private. Consumers see only `overlay.*`, `<OverlayRenderer />`, and `confirm()`.
3. Wire `unmount` to Radix's `onCloseAutoFocus` on `DialogContent` / `AlertDialogContent` / `SheetContent`. Don't use `onAnimationEnd` (fires on child animations) and don't `e.preventDefault()` inside it (cancels focus restoration).
4. `openAsync` resolves via `close(value)` — never through side channels.
5. Don't use this for deep-linkable overlays (use nuqs) or structural compound UI (Tabs, Accordion).

## Anti-patterns

- `useState` boolean + controlled `<Dialog>` for an overlay triggered from one place.
- Payload lifted to the parent (`workspaceToDelete`, `memberToRemove`) — pass it as a prop in the `overlay.open` callback.
- Parallel mirror state — an `isFooModalOpen` flag in another store alongside `overlay.open`.
- Global modal registry with string keys (`openModal('confirm', ...)`) — co-locate JSX with the trigger.
- Calling `unmount()` synchronously on close — kills the exit animation.
- Wrapping the app in an `<OverlayProvider>` — the renderer is a sibling component, not a Provider.

## Cross-skill interaction

- **`frontend-state-management`** — server data, URL state, and forms inside overlays still follow that skill.
- **`frontend-accessibility`** — Radix handles focus trap, restoration, Esc, ARIA, scroll lock. Don't override; see Accessibility above.
- **`frontend-ux-copywriting`** — `confirmLabel` and dialog title rules.
- **`frontend-ux-layouts`** — Dialog / Sheet sizing rules (Section 8).
- **`frontend-component-design`** — shadcn primitives, consumed unchanged.
- **`frontend-conventions`** — `@/*` import alias.

## Origin

Pattern adapted from [Toss's `overlay-kit`](https://github.com/toss/overlay-kit), simplified by replacing the emitter + reducer + Provider with a Zustand store + renderer. Other peer implementations: Ant Design `App.useApp()`, Mantine `modals.open`, eBay `nice-modal-react`, Sonner `toast()`. The "render inside the existing tree" architecture (vs `ReactDOM.render` to a new root) is what preserves Context — see Ant Design's [Pain of static methods](https://ant.design/docs/blog/why-not-static/) for why the alternative was abandoned.
