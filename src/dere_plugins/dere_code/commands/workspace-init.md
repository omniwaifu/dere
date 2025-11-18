---
description: Initialize workspace and activate Serena
allowed-tools: Bash, mcp__plugin_workforce-assistant_serena__*
---

Initialize workspace and activate Serena for current project.

Execute these steps:

1. Update .gitignore:
   ```bash
   echo "" >> .gitignore
   echo ".serena/" >> .gitignore
   ```

2. Activate Serena:
   ```
   # Project activation happens automatically via Serena MCP
   # (Claude Code 1.0.52+ automatically loads Serena instructions)

   # Check onboarding status
   mcp__plugin_workforce-assistant_serena__check_onboarding_performed()

   # If not onboarded: call onboarding() and follow its prompts
   # If onboarded: list_memories() and load relevant ones
   ```

3. Report completion:
   - Serena: activated
   - Onboarding: checked/completed
   - Memories: loaded
   - Status: ready

## Purpose

One-command bootstrap for Serena-powered development.

## Requirements

**Serena MCP must be installed:**
```bash
claude mcp add serena -- uvx --from git+https://github.com/oraios/serena \
  serena start-mcp-server --context ide-assistant --project "$(pwd)"
```

**Context7 (optional but recommended):**
```bash
claude mcp add context7 -- npx -y @context7/mcp-server
```

## Troubleshooting

**Slow symbol tools on first use**
- Serena is parsing codebase (one-time operation)
- Optional: Pre-index with `uvx --from git+https://github.com/oraios/serena serena project index`
