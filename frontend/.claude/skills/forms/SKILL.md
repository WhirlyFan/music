---
name: frontend-forms
description: Form patterns for the Next.js app — TanStack Form + Zod, enabled-submit-with-inline-errors, scroll-to-first-invalid, input-level constraint enforcement, and accessible error wording. Use when building or modifying any form (multi-field create/edit, settings, auth, invite, configuration, etc.).
---
# Frontend Forms

This skill is the **canonical form pattern** for the Next.js app (`frontend/`). Apply it to every multi-field form — create dialogs, edit pages, settings panels, invite flows, auth forms, configuration forms.

Reference implementation: `frontend/src/app/(app)/workspace/[workspaceId]/(chrome)/capture/components/PipelineEntryForm.tsx`.

## Form state does not survive unmount

TanStack Form's state lives in a component-scoped store created by `useForm()`. When the route changes or the dialog closes, the form unmounts and the values are gone. Same for React Query cache — it's wiped on route changes by default and was never meant to be a writable scratchpad.

If you need a draft to survive navigation away from the form, hold it in **Zustand** — a plain in-memory store. Zustand survives SPA navigation because the store lives on the JS module, not on a component. Reference: `frontend/lib/stores/useAddOpportunityDraftStore.ts`.

**Default to in-memory**, not `persist` middleware. A page reload or tab close is a meaningful break in the session — the user generally expects a fresh slate after that, and persisting to localStorage introduces cross-tab leakage and stale-draft surprises. Reach for `persist` only when there's a stated requirement to survive reloads.

Wire it up with TanStack Form's `listeners.onChange` (debounced):

```ts
const form = useForm({
  defaultValues: { fields: initialDraft?.fields ?? EMPTY, stageId: initialDraft?.stageId ?? null },
  validators: { onSubmit: ... },
  listeners: {
    onChange: ({ formApi }) => {
      onDraftChange?.({
        fields: formApi.state.values.fields,
        stageId: formApi.state.values.stageId,
      });
    },
    onChangeDebounceMs: 300,
  },
  onSubmit: async (...) => { ... },
});
```

Then in the page/dialog:

```ts
const initialDraft = useDraftStore((s) => s.drafts[workspaceId]);
const setDraft = useDraftStore((s) => s.setDraft);
const clearDraft = useDraftStore((s) => s.clearDraft);

// pass `initialDraft` + `onDraftChange={(d) => setDraft(workspaceId, d)}` to the form
// call `clearDraft(workspaceId)` on successful submit AND on cancel
```

**Always clear the draft on**:
- successful submit (otherwise the next visit re-prompts the user with what they just saved)
- explicit cancel (cancel means discard)

**Never clear on**:
- unmount (the whole point is to survive unmount)
- route change (likewise)

**Key drafts per workspace** (or per logical scope) — a single global draft slot clobbers itself when the user moves between workspaces with unfinished drafts.

**Clear the previous workspace's draft on workspace switch.** Any per-workspace Zustand state must be wired into `useWorkspaceCleanup` (`frontend/lib/hooks/useWorkspaceCleanup.ts`) — that hook removes the previous workspace's React Query keys and resets the corresponding Zustand stores when `workspaceId` changes. Without this, persisted state from a workspace the user just left can leak back through a new tab or reload.

Do **not** use React Query for drafts. The cache is for *server* state — its lifecycle (gcTime, staleTime, broadcast invalidation) fights with the "always available, only cleared explicitly" contract a draft needs.

## Where state lives

| State | Tool | Why |
|---|---|---|
| **Form field values + validation** | **TanStack Form + Zod** | Schema-driven, type-safe, built-in dirty/touched/error tracking |
| **Shared client UI state outside the form** (which dialog is open, which tab is active, selected items list, draft persistence across navigation) | **Zustand** | Shared across components, survives the form unmounting |
| Server data displayed in or submitted to the form | React Query | Cached, deduped — call `useQuery` directly in the form |
| URL-worthy state (tab, filter on the page hosting the form) | nuqs | Shareable, bookmarkable |
| Single-component ephemeral state (popover open within a field) | `useState` | Scoped to one component |

The **boundary**: form values themselves always live in TanStack Form, never Zustand. Zustand is for state *outside* the form that the form interacts with (the page's open dialog flag, a multi-select selection list shared with a sibling, a persisted draft for offline resilience).

Example split:
- "Should the create-opportunity dialog be open?" → Zustand
- "What did the user type into the title field?" → TanStack Form
- "List of opportunities to populate a dropdown" → React Query

## The Six Rules

1. **State + validation: TanStack Form + Zod** (Standard Schema). No `useState`-per-field. No `react-hook-form`. No ad-hoc validation functions scattered across handlers. No storing form values in Zustand — Zustand is for *shared* client state outside the form.
2. **One Zod schema, shared** between the form and its API route. Never duplicate. Export length caps and regex from the schema so the form can mirror them at the input level.
3. **Submit button stays enabled**, even when fields are invalid. Disable it *only* during in-flight submission to prevent double-submit.
4. **Surface validation three ways simultaneously** on failed submit: (a) inline field error under each invalid input, (b) a global `onSubmitInvalid` toast, (c) auto-scroll + focus the first invalid field.
5. **Enforce shape at the input itself** with `maxLength`, `inputMode`, `pattern`, and `onChange` filters. The validator enforces *completeness*; the input enforces *shape*.
6. **Error messages tell the user how to fix the problem.** Plain language, no blame, no jargon.

## Why these rules

### Why submit-button stays enabled

The "disabled-until-valid" pattern is now considered a UX anti-pattern:

- **Accessibility**: disabled buttons fail WCAG contrast and aren't focusable. Keyboard and screen-reader users can't discover *why* they're blocked.
- **Discoverability**: a greyed-out button gives zero information about which field is missing. On a long form, users hunt.
- **Industry consensus**: [NN/G](https://www.nngroup.com/articles/errors-forms-design-guidelines/), [Smashing Magazine](https://www.smashingmagazine.com/2021/08/frustrating-design-patterns-disabled-buttons/), [Adrian Roselli](https://adrianroselli.com/2024/02/dont-disable-form-controls.html), and [Smart Interface Design Patterns](https://smart-interface-design-patterns.com/articles/disabled-buttons/) all recommend keeping the action available and showing inline errors on attempt.

The one valid disabled case is the in-flight submission window — prevents double-submits.

### Why inline + toast + scroll

Inline errors next to each field minimize working-memory load — users can see the problem while fixing it ([NN/G error guidelines](https://www.nngroup.com/articles/errors-forms-design-guidelines/)). The toast tells the user *something* went wrong when the field is below the fold. The scroll lands them on the problem instantly without hunting.

### Why constrain at the input level

A user can paste 5,000 characters into a 256-char `title` field. Validators catch it on submit, but by then the user has typed an essay. `maxLength` + `inputMode` + character-class filters mean the input *can't* receive invalid shape in the first place. Validators then enforce completeness (e.g. NAICS must be exactly 6 digits, not 1–6).

## The Pattern

### 1. Define a shared Zod schema

```ts
// frontend/lib/schemas/my-entity.ts
import { z } from 'zod';

// Export length caps so the form can mirror them as maxLength.
export const MAX_TITLE = 256;
export const MAX_DESCRIPTION = 4000;

const trimmedOptional = z
  .string()
  .optional()
  .transform((v) => {
    if (v == null) return undefined;
    const trimmed = v.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  });

export const myEntitySchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(MAX_TITLE),
  description: trimmedOptional.pipe(z.string().max(MAX_DESCRIPTION).optional()),
  // ...
});

export type MyEntityInput = z.input<typeof myEntitySchema>;
```

Use the **same** schema in the API route. Re-importing it is the goal — no duplication.

### 2. Wire up TanStack Form

```tsx
const form = useForm({
  defaultValues: EMPTY_FIELDS,
  validators: {
    onSubmit: ({ value }) => {
      const result = myEntitySchema.safeParse(value);
      if (result.success) return undefined;
      return { fields: result.error.flatten().fieldErrors };
    },
  },
  onSubmitInvalid: ({ formApi }) => {
    toast({
      title: 'Missing required fields',
      description: 'Please fill in the highlighted fields and try again.',
    });
    focusFirstInvalidField(formApi.state.fieldMeta);
  },
  onSubmit: async ({ value }) => {
    const parsed = myEntitySchema.parse(value);
    await mutation.mutateAsync(parsed);
  },
});
```

### 3. Submit button — enabled, except while submitting

```tsx
<form.Subscribe selector={(state) => [state.isSubmitting]}>
  {([isFormSubmitting]) => (
    <Button
      type="submit"
      variant="primary"
      disabled={isSubmitting || isFormSubmitting}
    >
      {isSubmitting || isFormSubmitting ? 'Saving…' : 'Save'}
    </Button>
  )}
</form.Subscribe>
```

**Never** include `!canSubmit` or `!isValid` in `disabled`. Let users click; show errors inline.

### 4. Scroll + focus the first invalid field

```ts
function focusFirstInvalidField(fieldMeta: Record<string, { errors?: unknown[] }>): void {
  if (typeof document === 'undefined') return;
  const invalidNames = Object.entries(fieldMeta)
    .filter(([, meta]) => (meta.errors?.length ?? 0) > 0)
    .map(([name]) => name);
  if (invalidNames.length === 0) return;

  // CSS.escape because TanStack Form names contain dots ("fields.title").
  const selector = invalidNames.map((n) => `#${CSS.escape(n)}`).join(', ');
  const first = document.querySelector<HTMLElement>(selector);
  if (!first) return;

  first.scrollIntoView({ behavior: 'smooth', block: 'center' });
  first.focus({ preventScroll: true });
}
```

DOM order matters — `fieldMeta` key iteration isn't guaranteed to match visual order. `document.querySelector` with a multi-selector returns the topmost match.

The field's `<input id={field.name}>` makes the lookup direct.

### 5. Enforce shape at the input

Mirror the schema's caps and character classes on the actual `<Input>` / `<Textarea>`:

```tsx
// String field — apply schema maxLength
<Input maxLength={MAX_TITLE} ... />

// Numeric-only field (e.g. 6-digit NAICS code)
<Input
  inputMode="numeric"
  maxLength={6}
  onChange={(e) => field.handleChange(e.target.value.replace(/\D/g, ''))}
  ...
/>

// Uppercase alphanumeric (e.g. 4-char PSC code)
<Input
  autoCapitalize="characters"
  maxLength={4}
  onChange={(e) =>
    field.handleChange(e.target.value.replace(/[^A-Za-z0-9]/g, '').toUpperCase())
  }
  ...
/>
```

Belt-and-suspenders: the input enforces *what shape can exist*; the validator enforces *that the shape is complete*.

### 6. Inline `Field` wrapper

Standardize the field shell so label, control, and error always render the same way:

```tsx
function Field({ label, htmlFor, required, error, children }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-foreground text-xs font-medium">
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      {children}
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  );
}
```

Pass `error={field.state.meta.isTouched ? field.state.meta.errors[0] : undefined}` so errors don't appear before the user has interacted.

## Error Wording

Follow [NN/G error guidelines](https://www.nngroup.com/articles/error-message-guidelines/) and [hostile patterns](https://www.nngroup.com/articles/hostile-error-messages/):

| Don't | Do |
|---|---|
| "Field is blank." | "Please enter a title." |
| "Invalid input." | "Use a 6-digit number, e.g. 541330." |
| "Failed." | "We couldn't save this opportunity — try again or contact support." |
| All-uppercase / exclamation marks | Plain sentence case |

Rules:
- **Specific**: name the field, name the constraint
- **Actionable**: tell the user what to do, not just what's wrong
- **Polite**: no blame ("You entered the wrong format" → "Use a 6-digit number")
- **Plain language**: no "validation failed", "constraint violation", or other dev-speak
- **Show an example** when format isn't obvious (NAICS, PSC, currency code, ISO date)

## Validation Timing

| Trigger | Use for |
|---|---|
| `onChange` | Format validators on short fields (NAICS, PSC, URL). Show errors only after `isTouched`. |
| `onBlur` | Default for most fields — wait until the user moves on, then validate. |
| `onSubmit` | The whole-form Zod parse; cross-field rules. Errors here trigger the toast + scroll. |

Don't validate on every keystroke for required fields — let the user finish typing.

## What about non-text inputs?

| Control | Constraint mechanism |
|---|---|
| `<Combobox>` (search + select) | Options list is the constraint — value can only be a known option |
| `<Select>` | Same — limited to defined items |
| `<DateInput>` / `<input type="datetime-local">` | Browser-constrained to valid datetime; still validate ranges in Zod |
| Currency / country code | Use the Combobox with the canonical list (`@/lib/data/currencies`, `@/lib/data/countries`) — never a free-text field |

## Required vs Optional

- **Mark required fields** with an asterisk in the label (`<span className="text-destructive">*</span>`)
- **Don't** label optional fields as "(optional)" unless the form is dominated by required fields
- An empty optional field is `undefined`, not `""` — the schema's `trimmedOptional` handles this

## Anti-Patterns (do not)

- ❌ `disabled={!canSubmit}` or `disabled={!isValid}` on the submit button
- ❌ `useState` per field with manual `onChange` and `onBlur` handlers
- ❌ A Zod schema in the route that doesn't match the form's schema
- ❌ Letting users type past the schema's `maxLength` (the validator catches it, but the input should have stopped them)
- ❌ Error messages that only say what's wrong, not how to fix it
- ❌ Showing errors before the user has touched the field
- ❌ Native browser tooltips (`required`, `pattern` without surrounding logic) — use Zod + inline errors instead
- ❌ Blocking submit with "Form has errors" alert at the top with no scroll — the user has to find the field themselves

## When to use this skill

Apply this skill whenever you:
- Add a new form (dialog, page, sheet, drawer)
- Edit an existing form's validation
- Refactor `useState`-based form state to TanStack Form
- Migrate any form that currently uses disabled-until-valid

See [ENG-2486](https://linear.app/usul/issue/ENG-2486) for the codebase-wide migration scope.

## File Layout

```
frontend/lib/schemas/
  my-entity.ts                 # Zod schema + exported length caps, shared with API route

frontend/lib/forms/
  focusFirstInvalidField.ts    # (extract on first reuse — currently lives inline in PipelineEntryForm.tsx)

frontend/src/app/(app)/.../components/
  MyEntityForm.tsx             # TanStack Form, inline errors, scroll-to-first-invalid

frontend/src/app/api/.../route.ts
  // Re-imports the same schema from lib/schemas
```

## References

- NN/G — [10 Design Guidelines for Reporting Errors in Forms](https://www.nngroup.com/articles/errors-forms-design-guidelines/)
- NN/G — [Error Message Guidelines](https://www.nngroup.com/articles/error-message-guidelines/)
- NN/G — [Hostile Patterns in Error Messages](https://www.nngroup.com/articles/hostile-error-messages/)
- Smashing Magazine — [Usability Pitfalls of Disabled Buttons](https://www.smashingmagazine.com/2021/08/frustrating-design-patterns-disabled-buttons/)
- Adrian Roselli — [Don't Disable Form Controls](https://adrianroselli.com/2024/02/dont-disable-form-controls.html)
- MDN — [Constraint Validation API](https://developer.mozilla.org/en-US/docs/Web/HTML/Guides/Constraint_validation)
- TanStack Form — [Validation Guide](https://tanstack.com/form/v1/docs/framework/react/guides/validation)
- shadcn/ui — [TanStack Form integration](https://ui.shadcn.com/docs/forms/tanstack-form)
