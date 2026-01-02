#!/usr/bin/env bash
# PreToolUse: Grep → Suggest find_symbol for Code Searches
# Nudges to use language-aware symbol tools instead of text search

set -euo pipefail

HOOK_DATA=$(cat)
PATTERN=$(echo "$HOOK_DATA" | jq -r '.tool_input.pattern // ""')
GLOB=$(echo "$HOOK_DATA" | jq -r '.tool_input.glob // ""')
TYPE=$(echo "$HOOK_DATA" | jq -r '.tool_input.type // ""')

# Detect code file searches
CODE_TYPES="js|ts|tsx|jsx|py|java|go|rs|c|cpp|rb|php|swift|kt"
if [[ "$GLOB" =~ \.($CODE_TYPES)$ ]] || [[ "$TYPE" =~ ^($CODE_TYPES)$ ]] || [ -z "$GLOB" ]; then
  cat << PROMPT
🔍 Code Search Pattern: "${PATTERN}"

Consider symbol-aware alternative:
• find_symbol(name_path="${PATTERN}", substring_matching=true)
• Language-aware, finds definitions not just string matches
• Returns precise locations and can include bodies

Proceed with Grep if pattern-matching is truly needed.
PROMPT
fi

echo '{"status":"symbol_nudge_shown"}'
