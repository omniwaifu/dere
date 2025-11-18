#!/usr/bin/env bash
# PreToolUse: Read → Suggest Symbol Tools First
# Nudges to use get_symbols_overview before reading entire code files

set -euo pipefail

HOOK_DATA=$(cat)
FILE_PATH=$(echo "$HOOK_DATA" | jq -r '.tool_input.file_path // ""')

# Only nudge for code files
if [[ "$FILE_PATH" =~ \.(ts|tsx|js|jsx|py|java|go|rs|c|cpp|h|hpp|rb|php|swift|kt)$ ]]; then
  cat << PROMPT
⚠️  Reading code file: ${FILE_PATH}

Consider symbol-first approach:
• get_symbols_overview("${FILE_PATH}") - See structure without full content
• find_symbol(name_path, "${FILE_PATH}") - Locate specific symbols
• Then Read only if symbol tools insufficient

Proceed with Read if symbol tools aren't appropriate.
PROMPT
fi

echo '{"status":"nudge_shown"}'
