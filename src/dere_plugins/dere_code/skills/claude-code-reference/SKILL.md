---
name: claude-code-reference
description: Technical reference for Claude Code plugin system (hooks, skills, agents, commands, MCP). Triggers when working with plugin architecture or debugging plugin behavior.
---

# Claude Code Plugin System Reference

## Plugin Manifest (plugin.json)

**Location:** `.claude-plugin/plugin.json` (required)

**Environment vars:**
- `${CLAUDE_PLUGIN_ROOT}` - absolute path to plugin dir
- `${CLAUDE_PROJECT_DIR}` - absolute path to project root

**Debug:** `claude --debug` shows plugin loading, validation, registration

---

## 1. HOOKS

**What:** Automated actions at lifecycle events; run in parallel, 60s timeout

**Input:** JSON via stdin with tool_name, tool_input, tool_response
**Output:** Exit codes (0=success, 2=blocking error, other=non-blocking)
**Scripts:** Must be executable (`chmod +x`)

### Hook Types

**Command-based (script execution):**
```json
{
  "type": "command",
  "command": "./path/to/script.sh",
  "description": "What this hook does",
  "timeout": 60
}
```

**Prompt-based (LLM evaluation):**
```json
{
  "type": "prompt",
  "prompt": "Evaluate if condition is met...",
  "model": "haiku",
  "timeout": 30
}
```

**Model parameter (v2.0.41+):** Specify which model evaluates prompt-based stop hooks (default: haiku)

### Events & Matchers

| Event | When | Matcher |
|-------|------|---------|
| PreToolUse | Before tool execution | Tool name regex |
| PostToolUse | After tool completes | Tool name regex |
| PostCustomToolCall | After MCP tool | MCP tool only |
| UserPromptSubmit | Before Claude processes | No matcher |
| SessionStart | Init/resume | startup/resume/clear/compact |
| SessionEnd | Termination | No matcher |
| Stop | Main agent done | No matcher |
| SubagentStart | Subagent starts (v2.0.43+) | No matcher |
| SubagentStop | Subagent done | No matcher |

### Exit Codes
- `0`: Success, stdout shown
- `2`: Blocking, stderr to Claude
- Other: Non-blocking, stderr to user

### Constraints
- 60s timeout (configurable)
- Full filesystem access
- Config snapshot at startup (changes need `/hooks` review)
- Multiple hooks modifying same MCP output = conflict

### When to Use
- PreToolUse: validate/block before execution
- PostToolUse: log/analyze after execution
- PostCustomToolCall: transform MCP outputs
- SessionStart: inject context, set env vars

---

## 2. SKILLS

**What:** Directory-based capabilities Claude auto-activates based on task context

**How:** Claude reads descriptions, decides when to use (no user invocation)

### Structure
```
skill-name/
├── SKILL.md           (required: frontmatter + instructions)
├── reference.md       (optional)
└── examples.md        (optional)
```

### Frontmatter
```yaml
---
name: skill-id  # lowercase, hyphens, max 64 chars
description: "What and when"  # max 1024 chars, critical for discovery
allowed-tools: ["Bash", "Read"]  # optional, Claude Code only
---
```

### Constraints
- Name: lowercase, numbers, hyphens only
- Description must specify WHAT and WHEN for auto-discovery
- External dependencies must be pre-installed

### When to Use
- Complex, multi-file workflows
- Team-distributed capabilities
- Auto-discovery context

**vs Commands:** Skills = auto-invoked, directory; Commands = user-invoked, single file
**vs Agents:** Skills = main thread; Agents = separate context with tool restrictions

---

## 3. SLASH COMMANDS

**What:** User-invoked prompts via `/command-name [args]`

**Location:** `.claude/commands/` (project) or `~/.claude/commands/` (user)

### Format
```yaml
---
description: "Brief summary"
allowed-tools: ["Bash"]
argument-hint: "<arg1>"
model: "sonnet"
disable-model-invocation: true  # prevent auto-trigger
---

Command content with $ARGUMENTS, $1, $2 variables
```

### Features
- `$ARGUMENTS`: all args as string
- `$1`, `$2`: positional params
- `@filename`: embed file contents
- `!command`: execute bash (requires allowed-tools)

### Constraints
- No name conflicts between user/project levels
- SlashCommand tool: only custom commands with descriptions

### When to Use
- Quick prompt templates
- Manual invocation patterns
- Single-file use cases

---

## 4. SUBAGENTS

**What:** AI personalities with independent context windows, delegatable for specialized tasks

**How:** Claude auto-delegates OR user explicitly invokes; runs in separate context, returns results

### Format
```yaml
---
name: agent-id
description: "Natural language purpose"
tools: "Read,Edit,Bash"  # omit = all tools
model: "sonnet"  # or 'inherit'
skills: skill-name-1, skill-name-2  # optional: auto-load skills for agent (v2.0.43+)
permissionMode: plan  # optional: default | acceptEdits | plan (v2.0.43+)
---

System prompt with instructions
```

### Permission Modes (v2.0.43+)

- **default**: Standard approval prompts
- **acceptEdits**: Auto-accept file edits
- **plan**: Read-only analysis mode (no modifications allowed)

Use `plan` for read-only agents like archeologists/analyzers.

### Constraints
- **Cannot spawn other subagents**
- Separate context window per invocation
- Initial context-gathering latency
- Explicit tool list restricts access

### When to Use
- Domain-specific expertise
- Independent context preservation
- Tool access restrictions
- Complex multi-step workflows (chain multiple)

**vs Skills:** Agents = separate context, tool restrictions; Skills = main thread, auto-discovery

---

## 5. MCP (Model Context Protocol)

**What:** Open standard connecting Claude to external tools/databases/APIs

**How:** Server exposes tools/resources/prompts; Claude invokes directly

### Transport Types
1. **HTTP:** Remote cloud services (recommended)
2. **Stdio:** Local processes
3. **SSE:** Deprecated

### Configuration Scopes
- **Local** (default): Project-specific
- **Project:** Team-shared via `.mcp.json`
- **User:** Cross-project

**Precedence:** local > project > user

### Interaction
- **Direct tools:** Claude invokes functions
- **Resources:** `@mentions` inject context
- **Slash commands:** `/mcp__<server>__<prompt>`

### Constraints
- 10k token output warning (configurable)
- Security: third-party servers unverified
- Prompt injection risk
- Windows: requires `cmd /c` wrapper for npx

### When to Use
- External data integration
- API/database connectivity
- Custom tool development
- Team infrastructure

---

## Decision Matrix

| Need | Use |
|------|-----|
| Auto-trigger on lifecycle | Hooks |
| Validate/block tool calls | Hooks (PreToolUse) |
| Auto-discovered workflows | Skills |
| User-invoked templates | Slash Commands |
| Separate context for tasks | Subagents |
| External tool/API | MCP |
| Tool access restrictions | Subagents |
| Team-distributed capabilities | Skills or Plugins |
| Transform MCP outputs | Hooks (PostCustomToolCall) |

---

## Common Gotchas

1. Hooks: scripts must be executable; config changes need `/hooks` review
2. Skills: description must specify WHAT and WHEN
3. Commands: name conflicts fail between user/project
4. Subagents: cannot spawn other subagents; initial latency
5. MCP: third-party servers unverified; prompt injection risk
6. Paths: all relative paths in plugin.json start with `./`
