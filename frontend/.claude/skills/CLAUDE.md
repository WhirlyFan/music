# Frontend Skills

Frontend skills for Claude Code. Each subfolder contains a `SKILL.md` with conventions and patterns for a specific concern. UX skills are co-located here with a `ux-` prefix.

## Adding a new frontend skill

1. Create a new folder here (e.g. `testing/`)
2. Add a `SKILL.md` with frontmatter:
   ```yaml
   ---
   name: frontend-testing
   description: One-line description. Use when [condition].
   ---
   ```
3. Add an entry to `docs/agent-skills/SUMMARY.md` under the Frontend section
