---
name: serena-project-activator
description: Activates Serena LSP server and runs onboarding workflow for codebase projects. Automatically triggers when starting work on any project with Serena MCP available.
---

# Serena Project Activator

## Knowledge Sources

This project may have TWO knowledge sources:

1. **Claude Code Rules** (`.claude/rules/*.md`)
   - Auto-loaded at startup - always available
   - Static project conventions, coding standards
   - Path-scoped rules for different areas
   - No MCP dependency - very reliable

2. **Serena Memories** (`.serena/memories/*.md`)
   - Loaded after onboarding - requires MCP
   - Dynamic discoveries, session-specific context
   - Built up over time through development

**Rules = reliable foundation | Serena = session discoveries**

## Activation Sequence

### Step 1: Rules Load Automatically

Claude Code rules in `.claude/rules/` are already loaded at startup.
No action needed - static conventions are active.

### Step 2: Activate Serena (if available)

1. **Check Onboarding Status**

   ```
   mcp__plugin_dere-code_serena__check_onboarding_performed()
   ```

2. **If Not Onboarded - Run Onboarding**

   ```
   mcp__plugin_dere-code_serena__onboarding()
   # Creates: architecture_overview, code_style, suggested_commands
   ```

3. **If Already Onboarded - Load Memories**
   ```
   mcp__plugin_dere-code_serena__list_memories()
   mcp__plugin_dere-code_serena__read_memory("architecture_overview")
   ```

### Step 3: If Serena Fails

If MCP unavailable or onboarding fails:

- Rules still provide baseline project knowledge
- Session can proceed without dynamic context
- Note: Discoveries won't persist this session

## After Onboarding

Consider migrating static content to rules for reliability:

- `code_style` → `.claude/rules/code-style.md`
- `suggested_commands` → `.claude/rules/commands.md`

Keep in Serena:

- `architecture_overview` (may evolve)
- `footgun-*`, `pattern-*`, `decision-*` (dynamic)

## Performance Tip

If symbol tools are slow on first use, Serena is parsing the codebase. This only happens once per project.

## Remember

- Rules always load, Serena may not
- Onboarding creates foundational knowledge
- Memories persist across sessions
- Symbol tools are faster than Read/Grep for code
