---
description: Check recent Claude Code updates for changes that affect your setup
argument-hint: [num-versions]
model: claude-haiku-4-5
---

## Context

You are checking recent Claude Code release notes to identify changes that may affect the user's current setup. This helps stay current with new features, breaking changes, and deprecations.

The project may use Claude Code features like plugins, commands, hooks, skills, and MCP servers.

## Your Task

### Step 1: Get Release Notes

Fetch the Claude Code changelog from the official GitHub:
`https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md`

Use WebFetch to retrieve the changelog.

Extract the last $1 versions (default to 3 if no argument provided).

### Step 2: Check What Claude Code Features Are Used

**IMPORTANT: Do NOT scan or reference any `.claude` directory. You are banned from touching it.**

Scan the current project directory to identify what Claude Code features are used:

- Look for `commands/` directories (slash commands)
- Look for `skills/` directories (skills)
- Look for `agents/` directories (agents)
- Look for `hooks` in plugin.json files
- Check for MCP integrations

### Step 3: Cross-Reference and Analyze

Match release note topics against features found in Step 2:

**Topic matching keywords:**

- "hooks" / "hook" -> affects hooks
- "plugins" / "plugin" -> affects plugins
- "skills" / "skill" -> affects skills
- "commands" / "slash command" -> affects commands
- "MCP" / "mcp" -> affects MCP
- "deprecated" / "breaking" / "removed" -> flag as important

### Step 4: Generate Summary Report

Output a markdown report with these sections:

```markdown
## Claude Code Update Report

**Versions reviewed:** [list versions checked]
**Features used:** [brief summary of Claude Code features found in project]

### Relevant Changes

[List changes that affect features this project uses]

### New Features to Consider

[List new features that might be useful based on what you're doing]

### Breaking Changes / Deprecations

[Any deprecations or breaking changes that need attention]

### Recommendations

[Specific action items if any]
```

## Important Notes

- Focus on actionable information, not every minor change
- If a release mentions something the user doesn't use, skip it
- Highlight anything marked "deprecated" or "breaking"
- Be concise - this is a quick check, not an exhaustive audit
