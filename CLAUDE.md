@AGENTS.md

## Claude Code

Project skills live in `.agent/skills/`. That directory is the source of truth.

Use `.claude/skills/web-design` for `packages/web` business UI work.
Use `.claude/skills/ui-design` for `packages/ui` component-library work.

Do not duplicate skill content. The `.claude/skills/` entries are symlinks to `.agent/skills/`, matching the `.codex/skills/` layout.
