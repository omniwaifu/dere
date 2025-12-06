---
name: claude-code-reference
description: Technical reference for Claude Code plugin system (hooks, skills, agents, commands, MCP). Triggers when working with plugin architecture.
---

# Claude Code Plugin Reference

**Debug:** `claude --debug` shows plugin loading

## Hooks

Automated actions at lifecycle events. Input via stdin JSON, 60s timeout.

**Exit codes:** 0=success, 2=blocking (stderr to Claude), other=non-blocking

| Event | When | Matcher |
|-------|------|---------|
| PreToolUse | Before tool | Tool name regex |
| PostToolUse | After tool | Tool name regex |
| PostCustomToolCall | After MCP tool | MCP only |
| UserPromptSubmit | Before Claude | None |
| SessionStart | Init/resume | startup/resume/clear/compact |
| SessionEnd | Termination | None |
| Stop | Main agent done | None |
| SubagentStart/Stop | Subagent lifecycle | None |

```json
{"type": "command", "command": "./script.sh", "timeout": 60}
{"type": "prompt", "prompt": "Evaluate...", "model": "haiku"}
```

## Skills

Directory-based capabilities Claude auto-activates based on description.

```
skill-name/
├── SKILL.md       # frontmatter + instructions (required)
└── *.md           # optional references
```

```yaml
---
name: lowercase-hyphens-max64
description: "WHAT it does and WHEN to activate"  # max 1024 chars
allowed-tools: ["Bash", "Read"]
---
```

## Slash Commands

User-invoked prompts via `/command-name [args]`

**Location:** `.claude/commands/` (project) or `~/.claude/commands/` (user)

```yaml
---
description: "Brief summary"
allowed-tools: ["Bash"]
argument-hint: "<arg>"
model: "sonnet"
---
Content with $ARGUMENTS, $1, $2, @filename, !command
```

## Subagents

Separate context windows with tool restrictions.

```yaml
---
name: agent-id
description: "Purpose"
tools: "Read,Edit,Bash"  # omit = all
model: "sonnet"
skills: skill-1, skill-2
permissionMode: plan  # default | acceptEdits | plan
---
System prompt
```

**permissionMode:**
- `default`: normal approval prompts
- `acceptEdits`: auto-accept edits
- `plan`: read-only, no modifications

**Constraint:** Subagents cannot spawn other subagents.

## MCP

External tools via Model Context Protocol.

**Transport:** HTTP (recommended), Stdio, SSE (deprecated)
**Scopes:** local > project (.mcp.json) > user
**Invoke:** `mcp__<server>__<tool>`, resources via `@mentions`

## Decision Matrix

| Need | Use |
|------|-----|
| Auto-trigger on lifecycle | Hooks |
| Validate/block tool calls | Hooks (PreToolUse) |
| Auto-discovered capabilities | Skills |
| User-invoked templates | Slash Commands |
| Separate context + tool restrictions | Subagents |
| External API/database | MCP |

## Gotchas

- Hooks: scripts must be `chmod +x`; config changes need `/hooks` review
- Skills: description must say WHAT and WHEN
- Commands: name conflicts fail between user/project
- Subagents: cannot spawn subagents; initial latency
- MCP: third-party servers unverified
- Paths: relative paths in plugin.json start with `./`
