---
description: Spawn parallel agents from a plan or task description
allowed-tools: Task, Read, Glob, mcp__plugin_dere-core_swarm__spawn_agents, mcp__plugin_dere-core_swarm__list_plugins, mcp__plugin_dere-core_swarm__list_personalities, mcp__plugin_dere-core_swarm__wait_for_agents, mcp__plugin_dere-core_swarm__get_swarm_status, mcp__plugin_dere-core_swarm__get_agent_output, mcp__plugin_dere-core_swarm__merge_agent_branches, AskUserQuestion
argument-hint: <task or "from-plan">
---

# Spawn Swarm

**Input:** $ARGUMENTS

## Workflow

### 1. Determine source

If `$ARGUMENTS` is "from-plan" or references a plan file:

- Read the plan file from ~/.claude/plans/ (find most recent or specified)
- Parse the plan into parallelizable steps

Otherwise:

- Analyze `$ARGUMENTS` as a task description
- Decompose into parallel subtasks

### 2. Design agent configuration

For each subtask, determine:

- **name:** Short identifier (e.g., "auth-backend", "cache-impl")
- **prompt:** Self-contained task description with context
- **role:** "implementation", "review", "research", or "generic"
- **plugins:** `["dere_code"]` for coding, `[]` for research
- **depends_on:** List of agent names this depends on
- **personality:** Vary for perspective diversity

Call `list_plugins()` and `list_personalities()` to show available options.

### 3. Present plan to user

Show:

```
Swarm: [name]
Agents: [count]

| Agent | Role | Plugins | Dependencies |
|-------|------|---------|--------------|
| ...   | ...  | ...     | ...          |

Git branches: [yes/no with prefix]
```

Ask user to confirm or adjust before spawning.

### 4. Execute swarm

```python
result = await spawn_agents(
    swarm_name="...",
    git_branch_prefix="..." if coding else None,
    agents=[...],
)
```

### 5. Monitor and report

- Poll `get_swarm_status()` periodically
- When complete, summarize results
- For coding swarms, offer to merge branches

## Agent Design Guidelines

**Coding tasks:**

- Use `plugins: ["dere_code"]`
- Use `git_branch_prefix` for isolation
- Chain: impl agents → review agent

**Research tasks:**

- Use `plugins: []` (lean mode)
- No git branches needed
- Chain: research agents → synthesis agent

**Memory integration:**

- Swarms automatically include a `memory-steward` agent to consolidate findings
- Encourage agents to write durable facts to scratchpad keys under `memory/`

**Prompts should be self-contained:**

- Include relevant file paths
- Specify expected output
- Note any constraints

## Example Decomposition

**Task:** "Add user authentication with OAuth and session management"

| Agent        | Prompt                                       | Role           | Deps                     |
| ------------ | -------------------------------------------- | -------------- | ------------------------ |
| oauth-impl   | Implement OAuth 2.0 flow in src/auth/        | implementation | -                        |
| session-impl | Implement session management in src/session/ | implementation | -                        |
| integration  | Wire OAuth and sessions together             | implementation | oauth-impl, session-impl |
| reviewer     | Review all auth code for security issues     | review         | integration              |
