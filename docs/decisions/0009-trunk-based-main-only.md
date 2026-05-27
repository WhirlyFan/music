# 0009 — Trunk-based flow: branch off `main`, no long-lived `dev`

**Status:** Accepted
**Date:** 2026-05-26
**Supersedes:** [0007 — `dev` branch as integration target](0007-dev-branch-staging.md)

## Context

ADR 0007 introduced a long-lived `dev` integration branch between feature
branches and `main`. In practice it caused recurring pain:

- **Squash-merge ghost conflicts.** The branch-protection ruleset allows
  *only* squash merges. Every `dev → main` release squashes dev's commits
  into a single new commit on `main` with a fresh hash. dev still holds the
  originals. The two branches now contain identical *content* under
  different *commit hashes*, so the next feature branch — and the next
  `dev → main` PR — shows as `CONFLICTING` even though there's nothing to
  resolve. We hit this on three consecutive releases (#16, #18, #20, #21),
  each needing a manual rebase-onto-dev or cherry-pick-onto-main dance.
- **The staging buffer wasn't earning its keep.** For solo / small-team
  work the extra hop (feature → dev → main) added ceremony without catching
  anything CI didn't already catch. Render only ever deploys `main`, so
  `dev` was never a real pre-prod environment — just a second protected
  branch to keep in sync.

## Decision

Adopt **GitHub Flow** (trunk-based): `main` is the single long-lived branch
and the source of truth. Keep it current.

```
feature/foo ─┐
             ├──► main ──► Render auto-deploy to prod
feature/bar ─┘
```

- **All feature branches cut from `main`.**
- **PR feature → `main`.** CI gates it (Backend, Frontend, Security). Squash
  merge as before.
- **Merging to `main` deploys to prod** (Render watches `main`). Keep
  branches small so each merge is a low-risk increment.
- **No `dev` branch.** It's deleted. With one long-lived branch there is no
  hash divergence and no ghost conflicts — ever.
- **Hotfixes** are just normal feature branches off `main`.

## Consequences

### What we gain
- No squash-merge ghost conflicts. One trunk, one history.
- Less ceremony — one PR per change, not two merges.
- "What's in prod?" is unambiguous: it's `main`.
- New contributors don't have to learn a two-branch dance.

### What we give up
- **No staging buffer.** Anything merged to `main` ships. The mitigation is
  the discipline GitHub Flow already assumes: small PRs, green CI, and —
  when a change is genuinely risky — a feature flag or a manual
  smoke-test on a preview deploy rather than a shared `dev` branch.
- If we later want true pre-prod validation, the right tool is **Render
  preview environments** (per-PR ephemeral deploys via the blueprint),
  not a long-lived `dev` branch. That gives a real environment per change
  without the permanent-divergence problem. Deferred until we need it.

## Migration

- `dev` branch deleted from origin.
- Branch-protection ruleset (#16860368) updated to drop `refs/heads/dev`
  from `ref_name.include` — only `~DEFAULT_BRANCH` (main) remains protected.
- `render.yaml` unchanged (already `branch: main`).

## Workflow

| Action | Target |
|---|---|
| Start any work (feature, fix, hotfix) | branch off `main` |
| Open a PR | base `main` |
| Merge (CI green) | `main` — squash. Render auto-deploys |
| Risky change needing validation | feature flag, or a Render preview deploy — not a shared branch |

## Sources

- [GitHub Flow](https://docs.github.com/en/get-started/using-github/github-flow)
- [Render preview environments](https://render.com/docs/preview-environments) — the path to pre-prod validation when we need it
