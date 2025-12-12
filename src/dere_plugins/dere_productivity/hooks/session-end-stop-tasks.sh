#!/usr/bin/env bash
# Session End: Remind to stop active tasks
# Warns if any tasks are currently active (started)

set -euo pipefail

# Check if task command is available
if ! command -v task &> /dev/null; then
  exit 0
fi

# Check for active tasks
ACTIVE_TASKS=$(task +ACTIVE export 2>/dev/null || echo "[]")
ACTIVE_COUNT=$(echo "$ACTIVE_TASKS" | jq 'length' 2>/dev/null || echo "0")

if [ "$ACTIVE_COUNT" -gt 0 ]; then
  # Extract description of active tasks
  TASK_DESCRIPTIONS=$(echo "$ACTIVE_TASKS" | jq -r '.[].description' 2>/dev/null | head -3)

  cat << PROMPT
⏱️  Active Tasks Reminder

You have $ACTIVE_COUNT task(s) still running:
$TASK_DESCRIPTIONS

Use stop_task MCP tool to stop tracking time, or mark_task_done if completed.
PROMPT
fi
