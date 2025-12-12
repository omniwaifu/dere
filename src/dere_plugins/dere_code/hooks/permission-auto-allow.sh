#!/usr/bin/env bash
# Permission Auto-Allow Hook (PermissionRequest)
# Auto-approves non-destructive MCP tools to reduce friction
# Only code modification tools still require manual approval

set -euo pipefail

# Parse hook data from stdin
HOOK_DATA=$(cat)

# Extract tool name
TOOL_NAME=$(echo "$HOOK_DATA" | jq -r '.tool_name // ""')

# Serena tools to auto-approve (everything except code modification)
SERENA_ALLOW=(
  "list_dir"
  "find_file"
  "get_symbols_overview"
  "find_symbol"
  "find_referencing_symbols"
  "search_for_pattern"
  "check_onboarding_performed"
  "initial_instructions"
  "onboarding"
  "read_memory"
  "list_memories"
  "write_memory"
  "edit_memory"
  "delete_memory"
  "think_about_collected_information"
  "think_about_task_adherence"
  "think_about_whether_you_are_done"
)

# Zotero read tools
ZOTERO_ALLOW=(
  "search_zotero"
  "list_collections"
  "list_all_tags"
  "list_unfiled_items"
)

# Check Serena tools
for tool in "${SERENA_ALLOW[@]}"; do
  if [[ "$TOOL_NAME" == *"serena__$tool"* ]]; then
    echo '{"hookSpecificOutput": {"hookEventName": "PermissionRequest", "decision": {"behavior": "allow"}}}'
    exit 0
  fi
done

# Check Zotero tools
for tool in "${ZOTERO_ALLOW[@]}"; do
  if [[ "$TOOL_NAME" == *"zotero__$tool"* ]]; then
    echo '{"hookSpecificOutput": {"hookEventName": "PermissionRequest", "decision": {"behavior": "allow"}}}'
    exit 0
  fi
done

# Context7 - all tools are read-only
if [[ "$TOOL_NAME" == *"context7__"* ]]; then
  echo '{"hookSpecificOutput": {"hookEventName": "PermissionRequest", "decision": {"behavior": "allow"}}}'
  exit 0
fi

# Default: let normal permission flow handle it
echo '{}'
exit 0
