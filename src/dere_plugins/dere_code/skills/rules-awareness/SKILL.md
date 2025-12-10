---
name: rules-awareness
description: Manage Claude Code rules in .claude/rules/. Triggers when user asks about project conventions, coding standards, or wants to add static directives.
---

# Rules Awareness

## What are Rules?

Static project directives in `.claude/rules/*.md`:
- Auto-loaded at startup (no MCP needed)
- Path-scoped via YAML frontmatter
- More reliable than Serena memories for permanent info
- User-owned and version-controlled

## When to Suggest Rules

User says:
- "We always..." / "Never..."
- "Add this to project standards"
- "Everyone on the team should know..."
- Asking about coding conventions

## Rule Structure

```markdown
---
paths: src/**/*.ts  # Optional: only apply to matching files
---

# Rule Title

- Directive 1
- Directive 2
```

## Path Scoping Examples

```yaml
# Frontend only
paths: src/frontend/**/*.{ts,tsx}

# Tests only
paths: tests/**/*.test.ts

# Backend Python
paths: src/**/*.py

# Multiple areas
paths: {src,lib}/**/*.py
```

## Organization

```
.claude/rules/
├── code-style.md      # General style
├── testing.md         # Test conventions
├── commands.md        # Build/test/lint commands
├── frontend/
│   ├── react.md       # React-specific
│   └── styles.md      # Styling rules
└── backend/
    ├── database.md    # DB conventions
    └── errors.md      # Error handling
```

## Workflow

1. User mentions permanent convention
2. Suggest specific rule file and content
3. User creates/edits the file
4. Rule auto-loads on next session (or after `/clear`)

## DO NOT

- Auto-create rules (user must own them)
- Put session discoveries in rules (use Serena memories)
- Duplicate README content (reference it instead)
- Add volatile information to rules

## Rules vs Serena

| Use Rules | Use Serena |
|-----------|------------|
| Coding standards | Discovered footguns |
| Build commands | Session patterns |
| Static conventions | Dynamic decisions |
| Team agreements | Personal learnings |
