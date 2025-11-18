#!/usr/bin/env bash
# Research Note Auto-Capture Hook (PostToolUse)
# Automatically captures research from WebFetch/WebSearch with citations
# Inspired by eigent's note-taking system and search agent patterns

set -euo pipefail

# Parse hook data from stdin
HOOK_DATA=$(cat)

# Extract tool information (correct field names from Claude Code)
TOOL_NAME=$(echo "$HOOK_DATA" | jq -r '.tool_name // "unknown"')

# Only process WebFetch and WebSearch tools
if [[ "$TOOL_NAME" != "WebFetch" ]] && [[ "$TOOL_NAME" != "WebSearch" ]]; then
  echo "{\"status\": \"skipped\", \"reason\": \"not a research tool\"}"
  exit 0
fi

# Extract details
TOOL_ARGS=$(echo "$HOOK_DATA" | jq -r '.tool_input // {}')
TOOL_RESULT=$(echo "$HOOK_DATA" | jq -r '.tool_response // ""')
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
DATE_ONLY=$(date -u +"%Y-%m-%d")

# Extract URL if present
URL=$(echo "$TOOL_ARGS" | jq -r '.url // .query // "N/A"')

# Create .agent-notes directory if it doesn't exist
NOTES_DIR="${PWD}/.agent-notes"
mkdir -p "$NOTES_DIR"

# Research log file (dated)
RESEARCH_FILE="${NOTES_DIR}/research-${DATE_ONLY}.md"

# Initialize research file if it doesn't exist
if [ ! -f "$RESEARCH_FILE" ]; then
  cat > "$RESEARCH_FILE" << EOF
# Research Notes - ${DATE_ONLY}

Auto-captured by workforce-assistant plugin.
All research findings with citations and timestamps.

**Key Principle:** Record ALL information in detail. Do not summarize.
Your notes are the PRIMARY source for implementation decisions.

---

EOF
fi

# Truncate result to reasonable length
RESULT_PREVIEW=$(echo "$TOOL_RESULT" | head -c 2000)
if [ ${#TOOL_RESULT} -gt 2000 ]; then
  RESULT_PREVIEW="${RESULT_PREVIEW}... (truncated, total: ${#TOOL_RESULT} chars)"
fi

# Append research entry
cat >> "$RESEARCH_FILE" << EOF

## ${TIMESTAMP} - ${TOOL_NAME}

**Source:** ${URL}

**Findings:**
\`\`\`
${RESULT_PREVIEW}
\`\`\`

---

EOF

# Output success message
echo "{\"status\": \"captured\", \"tool\": \"${TOOL_NAME}\", \"file\": \"${RESEARCH_FILE}\"}"
