---
name: docs-maintenance
description: How to keep docs/ in sync with code. Covers the mental model (README vs docs vs Notion vs ADRs), the per-topic update matrix, ADR rules, style conventions, and the verification checklist. Use whenever you change architecture, auth, RLS, permissions, jobs, frontend stack, ops, or deploy targets — and any time a new long-form doc would be useful.
---

# docs-maintenance

How to keep the `docs/` folder useful as the codebase evolves. Read this
before editing or adding documentation files.

## The mental model

Three docs surfaces, each with a distinct job. Don't conflate them.

| Surface | Job | Mutability |
|---|---|---|
| `README.md` (root) | **How** — install, run, day-to-day commands | Update whenever commands change |
| `docs/` (this repo) | **Why** — design, trade-offs, constraints, current truth | Update with every architecture-affecting PR |
| Notion plan | **Original intent** — frozen snapshot of the day-one design | Read-only history. **Never** sync back. |
| `docs/decisions/` (ADRs) | **One-way doors** — single accepted decisions w/ reasoning | Immutable once accepted; supersede via new ADR |

If you find yourself wanting to write a how-to that's longer than a paragraph
and not in code, it almost certainly belongs in `docs/`, not the README.

## When to update what — the matrix

Before merging a PR, check this against your diff:

| You changed… | Touch this | Plus |
|---|---|---|
| The set of services in compose | `docs/architecture.md` | `docs/ops.md` if env vars change |
| Anything nginx-related | `docs/architecture/nginx.md` | `docs/architecture.md` topology section |
| Login / sessions / CSRF / social | `docs/auth.md` | new ADR if the change is one-way |
| MFA policy / staff gate | `docs/auth.md` + `docs/permissions.md` | possibly supersede ADR 0006 |
| RLS policy shape / roles / middleware | `docs/rls.md` | tests in `apps/notes/tests/test_rls.py` |
| `is_staff` / `is_superuser` / Groups / object-level | `docs/permissions.md` | |
| Hatchet workflow topology, DAG patterns | `docs/jobs.md` | possibly supersede ADR 0002 |
| TanStack stack, theming, FE auth wrapper | `docs/frontend.md` | |
| Compose / env vars / migrations / seed | `docs/ops.md` | `docs/architecture.md` if a service appears |
| Render / GCP deploy mechanics | `docs/ops/deploy-*.md` | new ADR if changing target |
| **One-way-door choice** (rename, swap, drop) | new `docs/decisions/000N-*.md` | the affected topic doc(s) |

If your change touches code but you skipped the docs row above — that's a
signal to revisit before merging.

## ADR rules (non-negotiable)

ADRs in `docs/decisions/` capture *immutable* decisions. They are not
living docs. The rules:

1. **One decision per ADR.** Don't bundle "auth + permissions" — split.
2. **Accepted ADRs are never edited.** To change your mind, write a new
   ADR that explicitly says "Supersedes 000N." The old one stays as
   historical record.
3. **Number sequentially.** `0001-`, `0002-`, … never skip.
4. **Filename = kebab-case slug.** `0006-mfa-optional-staff-required.md`.
5. **Required sections:**
   - `**Status:**` Accepted | Superseded by 000N | Deprecated
   - `**Date:**` ISO date
   - `## Context` — the forces in tension, options surveyed
   - `## Decision` — what we chose, in one paragraph
   - `## Consequences` — what we gain, what we give up, what becomes harder
6. **Lead with why, not what.** The codebase shows *what*; the ADR
   captures the reasoning future-you needs.

When an ADR is superseded:
- Old ADR: change `Status:` to `Superseded by 000N`
- New ADR: include `Supersedes 00M` in the Status line, link to it

Currently accepted ADRs:
- [0001 — RLS day one](../../../docs/decisions/0001-rls-day-one.md)
- [0002 — Hatchet Lite over Celery](../../../docs/decisions/0002-hatchet-lite-over-celery.md)
- [0003 — allauth headless](../../../docs/decisions/0003-allauth-headless.md)
- [0004 — TanStack Router](../../../docs/decisions/0004-tanstack-router.md)
- [0005 — Render-first deploy](../../../docs/decisions/0005-render-first-deploy.md)
- [0006 — MFA optional + staff required](../../../docs/decisions/0006-mfa-optional-staff-required.md)

## Style conventions

### What to write

- **Why over what.** Code already says what. The doc exists to capture intent.
- **Trade-offs explicit.** "Option A vs Option B" tables are gold.
- **Footguns documented.** If a future contributor would hit a non-obvious
  failure mode, write it down. Phrase as "If you see X, the cause is Y."

### What NOT to write

- **Don't document things derivable from code.** File paths, function
  signatures, struct shapes — `git grep` is faster than reading prose.
- **Don't restate the code in English.** "The `Note` model has an `owner`
  FK to `User`" is wasted text — anyone can read `models.py`.
- **Don't add fluff.** "This is a very important feature that…" earns
  zero trust. Lead with the rule.
- **Don't reference the current task / PR.** "Added for issue #123" rots
  the moment the next PR lands. Belongs in commit messages.

### Cross-linking

Link liberally between docs. The web of internal links is what makes
`docs/` navigable. Patterns:

- Topic doc → topic doc: `[auth.md](auth.md)`
- Topic doc → ADR: `[decisions/0001-rls-day-one.md](decisions/0001-rls-day-one.md)`
- ADR → topic doc: `[../auth.md](../auth.md)`
- Topic doc → source code: `[apps/core/middleware.py](../backend/apps/core/middleware.py)`

If you write a doc that doesn't link to or from any other doc, you've
made a quote, not a connection.

### Tone

Direct, calm, no hedging. Examples:

| ❌ Avoid | ✅ Prefer |
|---|---|
| "It might be a good idea to consider…" | "Use X because Y. The cost is Z." |
| "We believe this is the right approach" | "We do this because [reason]." |
| "This is a really powerful feature" | (Cut the sentence; show, don't tell.) |
| "TODO: figure out later" | "Deferred. The trigger to add this is [specific condition]." |

## Verification before merging a doc change

Run through this checklist:

1. **Cross-references resolve.** Click every internal link in your diff.
   Broken links = stale docs.
2. **Code references exist.** If you cite `apps/core/X.py::Y`, verify the
   file + symbol still exist. `git grep "def Y"` takes 5 seconds.
3. **Examples run.** Code blocks in docs should be copy-pasteable. If you
   show a CLI command, it should work as written.
4. **The doc reads cold.** Imagine you've never seen this project. Does
   the first paragraph orient you? Does the rest answer "why?"
5. **No "what I just did" mentions.** No "in this PR…" or "we just
   added…". Future readers don't care.
6. **Update `docs/README.md`** if you added a new file or significantly
   changed an existing topic's scope.

## Adding a new topic doc

When a topic grows enough to deserve its own file:

1. Pick a one-word filename if possible: `rls.md`, `auth.md`, `jobs.md`
2. If the topic needs sub-pages, create `docs/<topic>/` and put
   `docs/<topic>.md` as the entry point
3. Add an entry to `docs/README.md`'s "Topic docs" table
4. Add a row to the "When to update what" matrix at the top of this
   skill *and* in `docs/README.md`
5. Cross-link from at least one existing doc

## When the Notion plan and `docs/` disagree

`docs/` wins. Notion is the original-intent snapshot — it does not get
updated to track current state. If you want to know what we *decided to
do*, read Notion. If you want to know what we're *actually doing now*,
read `docs/`. When they diverge, that divergence is the audit trail of
how the project evolved.

Never sync `docs/` changes back into Notion.

## Output format when adding/updating docs

When invoking this skill, end your work with a short report:

```
Updated:
  - docs/X.md — <one-line summary>
  - docs/Y.md — <one-line summary>
Added:
  - docs/decisions/000N-foo.md — Accepted

Verified:
  - Internal links resolve
  - Code references checked: <file>:<symbol>
```

This lets the user spot stale claims without re-reading every diff.

## Examples of changes that should trigger docs updates

| PR scope | Files touched in `docs/` |
|---|---|
| Add a new RLS-scoped model | `rls.md` (extend "Extending the policy" if novel) |
| Swap from gunicorn to uvicorn | `architecture.md`, `ops.md`, possibly new ADR |
| Add "Sign in with Google" | `auth.md`, possibly new ADR if Google is the first social provider |
| Drop nginx in favor of Vite proxy | `architecture/nginx.md`, `architecture.md`, **new ADR** (one-way door) |
| Rename `Note` to `Document` | nothing — that's a rename, not an architectural change |
| Change pre-push hook to use lefthook | `ops.md`, possibly new ADR |
| Move from Render to Cloud Run | `ops/deploy-cloudrun.md` (new), `ops/deploy-render.md` (update status), supersede ADR 0005 |
| Add CI on GitHub Actions | `ops.md`, possibly new ADR if a tool choice was non-obvious |

If your PR doesn't fit any row above, the diff probably doesn't need a docs change.
