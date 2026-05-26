# Repo Skills

Root-level skills for this repository. Each subfolder contains a `SKILL.md`
with conventions and patterns for a specific repo-wide concern.

Frontend-specific skills live in [`frontend/.claude/skills/`](../../frontend/.claude/skills/CLAUDE.md).

## Adding a new repo skill

1. Create a new folder here (e.g. `release-process/`)
2. Add a `SKILL.md` with frontmatter:
   ```yaml
   ---
   name: docs-maintenance
   description: One-line description. Use when [condition].
   ---
   ```
3. Reference it from `docs/README.md` if it relates to docs/ workflow
