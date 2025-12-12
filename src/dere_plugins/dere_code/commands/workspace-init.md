---
description: Initialize workspace with Rules and/or Serena
allowed-tools: Bash, mcp__plugin_dere-code_serena__*
---

Initialize workspace for project with both knowledge systems.

## Steps

### 1. Setup Rules Directory (recommended)

```bash
mkdir -p .claude/rules
```

Consider creating initial rules from project README/docs:
- `.claude/rules/code-style.md` - coding conventions
- `.claude/rules/commands.md` - build/test/lint commands
- `.claude/rules/testing.md` - test requirements

### 2. Setup Serena (for dynamic memories)

```bash
grep -qxF '.serena/' .gitignore || echo '.serena/' >> .gitignore
```

Activate and onboard:
```
mcp__plugin_dere-code_serena__check_onboarding_performed()
# If not onboarded: call onboarding() and follow prompts
# If onboarded: list_memories() and load relevant ones
```

### 3. Report Status

- Rules: [created/existing] with X files
- Serena: [activated/skipped]
- Status: ready

## When to Use Each

| Use Rules | Use Serena |
|-----------|------------|
| Coding standards | Discovered footguns |
| Build commands | Session patterns |
| Static conventions | Dynamic decisions |
| Team agreements | Personal learnings |

**Rules = reliable foundation | Serena = session discoveries**

## Requirements

**Serena MCP (for dynamic memories):**
```bash
claude mcp add serena -- uvx --from git+https://github.com/oraios/serena \
  serena start-mcp-server --context ide-assistant --project "$(pwd)"
```

**Context7 (optional - library docs):**
```bash
claude mcp add context7 -- npx -y @context7/mcp-server
```

## Troubleshooting

**Slow symbol tools on first use**
- Serena is parsing codebase (one-time operation)
- Pre-index: `uvx --from git+https://github.com/oraios/serena serena project index`

**Serena unavailable**
- Rules still work without MCP
- Static conventions remain loaded
- Only dynamic memories are affected
