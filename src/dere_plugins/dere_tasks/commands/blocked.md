---
name: blocked
description: Show tasks blocked by dependencies
---

Use the `get_blocked_tasks` MCP tool to show tasks that are blocked by other tasks in the system (unmet dependencies).

For each blocked task, show:
- What it's waiting on (dependency chain)
- Why it's blocked
- What needs to happen to unblock it

Help me identify if any dependencies are stale or should be removed.
