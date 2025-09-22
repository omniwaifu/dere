---
allowed-tools: mcp__activitywatch__list_available_data, mcp__activitywatch__get_events
description: Start a wellness check-in session with activity tracking context
---

## Context

You have access to the ActivityWatch MCP server which tracks the user's computer activity. This includes:
- Application usage patterns
- Active vs AFK time
- Music and media consumption
- Gaming activity
- Study sessions

Available tools:
- `mcp__activitywatch__list_available_data`: Discover what activity data is available
- `mcp__activitywatch__get_events`: Get detailed events from specific buckets

## Your task

Begin a wellness check-in session. Start by:
1. Greeting the user appropriately based on the personality mode
2. Asking how they're feeling today
3. If helpful, you may query their recent activity to provide context-aware observations
4. Guide them through a natural check-in conversation
5. Extract wellness metrics at the end

Remember to maintain the personality traits while being therapeutic and supportive.