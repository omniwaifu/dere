#!/usr/bin/env bash
# Session Start: Show GTD task statistics
# Displays actionable task count at session start

set -euo pipefail

# Check if task command is available
if ! command -v task &> /dev/null; then
  exit 0
fi

# Count pending tasks that are actionable (not waiting, not blocked by wait date)
ACTIONABLE_COUNT=$(task status:pending -WAITING count 2>/dev/null || echo "0")
INBOX_COUNT=$(task status:pending +inbox count 2>/dev/null || echo "0")

if [ "$ACTIONABLE_COUNT" -gt 0 ] || [ "$INBOX_COUNT" -gt 0 ]; then
  cat << PROMPT
📋 GTD Task Status

$([ "$INBOX_COUNT" -gt 0 ] && echo "Inbox: $INBOX_COUNT items to process")
$([ "$ACTIONABLE_COUNT" -gt 0 ] && echo "Next Actions: $ACTIONABLE_COUNT tasks ready")

Use /inbox to process inbox items or /focus to find your next action.
PROMPT
fi
