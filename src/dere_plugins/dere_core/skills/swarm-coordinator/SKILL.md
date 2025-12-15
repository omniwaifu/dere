---
name: swarm-coordinator
description: Spawn parallel agents for multi-part tasks. Triggers when task has independent subtasks that benefit from parallelization (coding, research, review).
---

# Swarm Coordination

Spawn multiple background agents to work in parallel on independent subtasks.

## When to Use Swarm

- **Parallel coding:** Multiple independent files/features
- **Multi-perspective review:** Different reviewers checking same code
- **Research synthesis:** Parallel research threads + synthesis agent
- **Documentation:** Independent sections written in parallel

## When NOT to Use

- Sequential dependencies throughout
- Single-file changes
- Quick fixes (<10 min work)
- User wants to iterate interactively

## Available Tools

```
list_plugins()        # See available plugin configurations
list_personalities()  # See available agent personalities
spawn_agents(...)     # Create and start swarm
wait_for_agents(...)  # Block until completion
get_swarm_status(...) # Check progress
get_agent_output(...) # Get full results
merge_agent_branches(...) # Merge git branches
cancel_swarm(...)     # Abort execution
```

## Agent Configuration

| Task Type | plugins | git_branch_prefix | dependencies |
|-----------|---------|-------------------|--------------|
| Coding | `["dere_code"]` | `"feature-"` | impl -> review |
| Research | `[]` (lean) | None | parallel -> synthesis |
| Review | `["dere_code"]` | None | parallel |
| Docs | `["dere_code"]` | Optional | sections -> integration |

## Example: Coding Feature

```python
result = await spawn_agents(
    swarm_name="add-caching",
    git_branch_prefix="cache-",
    agents=[
        {
            "name": "redis-impl",
            "prompt": "Implement Redis caching for user sessions in src/cache/",
            "role": "implementation",
            "personality": "kuu",
            "plugins": ["dere_code"],
        },
        {
            "name": "memory-impl",
            "prompt": "Implement in-memory cache fallback",
            "role": "implementation",
            "personality": "tsun",
            "plugins": ["dere_code"],
        },
        {
            "name": "reviewer",
            "prompt": "Review both implementations for consistency and edge cases",
            "role": "review",
            "depends_on": ["redis-impl", "memory-impl"],
            "plugins": ["dere_code"],
        },
    ],
)

# Wait for all agents
results = await wait_for_agents(result["swarm_id"])

# Merge successful branches
await merge_agent_branches(result["swarm_id"], target_branch="feature/caching")
```

## Example: Research Deep-Dive

```python
result = await spawn_agents(
    swarm_name="auth-research",
    agents=[
        {
            "name": "oauth-research",
            "prompt": "Research OAuth 2.0 best practices for SPAs",
            "role": "research",
            "plugins": [],  # Lean mode - web only
        },
        {
            "name": "jwt-research",
            "prompt": "Research JWT vs session tokens trade-offs",
            "role": "research",
            "plugins": [],
        },
        {
            "name": "synthesizer",
            "prompt": "Synthesize research findings into recommendations",
            "role": "generic",
            "depends_on": ["oauth-research", "jwt-research"],
            "plugins": [],
        },
    ],
)
```

## Personality Selection

Vary personalities for diverse perspectives:
- `tsun`: Direct, critical, catches issues
- `kuu`: Methodical, thorough, follows patterns
- `yan`: Enthusiastic, creative approaches
- `dan`: Calm, balanced analysis

## Best Practices

1. **Clear prompts:** Each agent needs self-contained context
2. **Explicit dependencies:** Use `depends_on` for ordered execution
3. **Git isolation:** Use `git_branch_prefix` for code changes
4. **Monitor progress:** Check `get_swarm_status()` periodically
5. **Handle failures:** Check agent status before merging
