#!/usr/bin/env bash
# PostToolUse: After 5+ Symbol Calls → Suggest Memory Write
# Reminds to persist architectural discoveries after extensive exploration

set -euo pipefail

HOOK_DATA=$(cat)

# Track consecutive symbol tool calls
COUNTER_FILE="/tmp/serena-symbol-call-count-$$"
COUNT=0
if [ -f "$COUNTER_FILE" ]; then
  COUNT=$(cat "$COUNTER_FILE")
fi
COUNT=$((COUNT + 1))
echo "$COUNT" > "$COUNTER_FILE"

# After 5+ symbol calls, suggest memory
if [ "$COUNT" -ge 5 ]; then
  cat << PROMPT
📝 Architectural Discovery in Progress

You've made ${COUNT} symbol exploration calls. Consider:
• write_memory("architecture-{component}", findings)
• Document symbol locations for implementation
• Capture relationships and dependencies

This helps implement features without re-exploring.
PROMPT
  rm "$COUNTER_FILE"  # Reset counter
fi

echo '{"status":"counted"}'
