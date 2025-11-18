---
name: focus
description: Find the best next action for current context
---

Help me find what to work on right now using the `get_next_actions` MCP tool.

First ask me:
1. Where are you? (context: @home, @computer, @errands, @phone)
2. How much time do you have? (15 minutes, 1 hour, 2+ hours)
3. What's your energy level? (High, Medium, Low)

Then use `get_next_actions` with those filters and present 3-5 task options with reasoning for each. After I choose one, use `start_task` to begin tracking time.
