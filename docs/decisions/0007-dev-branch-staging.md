# 0007 — `dev` branch as the integration target; `main` as the deploy target

**Status:** Superseded by [0009](0009-trunk-based-main-only.md) (2026-05-26)
**Date:** 2026-05-26

> ⚠️ **Superseded.** The `dev` integration branch caused recurring
> squash-merge ghost conflicts and didn't earn its keep as a staging buffer.
> We moved to trunk-based flow (branch off `main`, no `dev`). See
> [ADR 0009](0009-trunk-based-main-only.md). This record is kept for history.

## Context

Originally we had a single long-lived branch (`main`) with every feature
PR targeting it directly. `render.yaml` watches `main` for auto-deploys
to production. That gave us one decision point — "is this ready to ship
to real users?" — which the same merge button had to answer.

Two failure modes that pattern hits as the project grows:

1. **No staging buffer.** Anything merged to `main` ships to prod. Good
   for moving fast solo; bad when a change *passes CI* but breaks in the
   real Render env (read-only-filesystem quirks, secret-var mismatches,
   etc. — we've hit these). Without a buffer, the fix-then-redeploy
   cycle happens on the public URL.
2. **Long-lived feature branches accumulate risk.** When work-in-progress
   sits on a branch waiting for "the right merge moment," conflicts
   build, code drifts, and the merge-to-`main` becomes the scary moment.

## Decision

Introduce a `dev` branch between feature branches and `main`:

```
feature/foo  ─┐
              ├──► dev  ──► main  ──► Render auto-deploy to prod
feature/bar  ─┘
```

- **Feature PRs target `dev`.** Smaller batches; lower stakes per merge;
  CI gates apply to dev just like main.
- **`main` is the deploy line.** A PR `dev → main` happens *only* when
  we're ready to ship the accumulated changes to production. Render's
  `branch: main` in `render.yaml` is unchanged.
- **Both branches are protected** by the same ruleset (#16860368):
  required CI checks, linear history, PRs required, no force-push, no
  deletion. The ruleset's `ref_name.include` lists
  `["~DEFAULT_BRANCH", "refs/heads/dev"]`.

## Consequences

### What we gain
- A staging surface: changes can sit on `dev` while we manually validate
  before promoting to `main`
- Smaller release units: `dev → main` PRs can be batched (multiple
  features in one release) or one-at-a-time, our choice
- Lower-stakes merges to `dev` — we can move fast there without each
  merge being a deploy
- A clear "what's in prod now?" answer: it's whatever's on `main`. To
  see "what's coming next?", check `dev`.

### What we give up
- A second protected branch to maintain
- Two-step releases: every change is two merges instead of one. For solo
  work that's a tiny tax; for team work the second step is cheap PR
  approval
- Slight risk of `dev` drifting if we never promote — counterbalanced by
  the fact that promoting is fast (linear-history rule means clean fast-
  forward / rebase merges)

### Open questions
- Should `dev` get its own deploy environment (e.g. `react-django-template-frontend-dev.onrender.com`)?
  Deferred. For now, dev is validated locally + via CI. Phase B can add
  preview environments via Render's blueprint preview feature.
- Should hotfixes branch from `main` (and forward-merge to `dev`) or
  always flow `dev → main`? Hotfixes can branch from `main` and PR
  directly to `main` — both branches are protected so CI still gates.
  After merge, sync `dev` from `main` to avoid drift.

## Workflow

| Action | Target |
|---|---|
| Open a feature PR | `dev` |
| Approve + merge feature | `dev` (CI must pass) |
| Ready to release? | Open a PR `dev → main` |
| Approve + merge release | `main` (CI must pass; Render auto-deploys) |
| Hotfix | Branch from `main`, PR to `main`, then sync `dev` |

## Sources

- [GitHub Flow vs Git Flow](https://docs.github.com/en/get-started/using-github/github-flow)
  — we're closer to "GitHub Flow with staging" than full Git Flow.
  No `release/*` or `hotfix/*` branches.
