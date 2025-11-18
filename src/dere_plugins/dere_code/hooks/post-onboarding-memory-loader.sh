#!/usr/bin/env bash
# PostToolUse: After Onboarding Check → Auto-suggest Loading Memories
# Automatically prompts to load existing memories after onboarding verification

set -euo pipefail

HOOK_DATA=$(cat)
RESPONSE=$(echo "$HOOK_DATA" | jq -r '.tool_response // "" | tostring')

# If onboarding was already performed, suggest loading memories
if echo "$RESPONSE" | grep -qi "already performed\|onboarding.*performed\|memories available"; then
  cat << PROMPT
📚 Onboarding Complete - Memories Available

Suggested immediate actions:
1. list_memories() - See what's available
2. read_memory("architecture_overview") - Understand structure
3. read_memory("code_style") - Follow conventions
4. read_memory("suggested_commands") - Know how to test/build

These provide context from previous work. Load relevant ones now.
PROMPT
fi

echo '{"status":"memory_loader_shown"}'
