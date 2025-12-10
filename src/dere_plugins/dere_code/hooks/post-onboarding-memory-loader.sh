#!/usr/bin/env bash
# PostToolUse: After Onboarding Check -> Load Memories + Suggest Rule Migration
# Automatically prompts to load existing memories and migrate static content

set -euo pipefail

HOOK_DATA=$(cat)
RESPONSE=$(echo "$HOOK_DATA" | jq -r '.tool_response // "" | tostring')

# If onboarding was already performed, suggest loading memories
if echo "$RESPONSE" | grep -qi "already performed\|onboarding.*performed\|memories available"; then
  cat << PROMPT
Onboarding Complete - Load Knowledge

Suggested actions:
1. list_memories() - See what's available
2. read_memory("architecture_overview") - Understand structure
3. read_memory("code_style") - Follow conventions
4. read_memory("suggested_commands") - Know how to test/build

MIGRATION TIP:
If code_style or suggested_commands contain static info,
consider moving to .claude/rules/ for reliability.
Rules auto-load without MCP dependency.

Example:
- code_style -> .claude/rules/code-style.md
- suggested_commands -> .claude/rules/commands.md
PROMPT
fi

echo '{"status":"memory_loader_shown"}'
