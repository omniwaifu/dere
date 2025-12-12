#!/usr/bin/env bash
# PostToolUse: WebFetch/WebSearch/Context7 → Prompt Memory Persistence
# Reminds to save research findings to Serena memories

set -euo pipefail

HOOK_DATA=$(cat)
TOOL_NAME=$(echo "$HOOK_DATA" | jq -r '.tool_name // "unknown"')

# Only trigger for substantial research (>500 chars)
RESPONSE_LENGTH=$(echo "$HOOK_DATA" | jq -r '.tool_response // ""' | wc -c)

if [ "$RESPONSE_LENGTH" -gt 500 ]; then
  cat << PROMPT
💾 Research Captured: ${TOOL_NAME}

Consider persisting findings:
• write_memory("research-{topic}", content)
• For library docs: write_memory("library-docs-{lib}-{topic}", content)
• Include source citations in memory

This helps future sessions avoid re-research.
PROMPT
fi

echo '{"status":"memory_nudge_shown"}'
