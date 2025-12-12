#!/usr/bin/env bash
# Safe Mode Guardian Hook (PreToolUse)
# Validates potentially destructive Bash commands before execution
# Inspired by eigent's safe_mode=True pattern

set -euo pipefail

# Parse hook data from stdin
HOOK_DATA=$(cat)

# Extract tool information
TOOL_NAME=$(echo "$HOOK_DATA" | jq -r '.tool // "unknown"')

# Only process Bash tool
if [[ "$TOOL_NAME" != "Bash" ]]; then
  echo "{\"status\": \"allowed\"}"
  exit 0
fi

# Extract command
COMMAND=$(echo "$HOOK_DATA" | jq -r '.args.command // ""')

# Define dangerous patterns
DANGEROUS_PATTERNS=(
  "rm -rf"
  "rm -fr"
  "chmod -R 777"
  "chown -R"
  "dd if="
  "> /dev/"
  "mkfs\."
  "fdisk"
  "parted"
  "format"
  "sudo rm"
  "sudo dd"
  "sudo chmod -R 777"
  ":(){:|:&};:"  # fork bomb
)

# Check for dangerous patterns
for pattern in "${DANGEROUS_PATTERNS[@]}"; do
  if echo "$COMMAND" | grep -qF "$pattern"; then
    # Block and require user confirmation
    cat << EOF
{
  "status": "blocked",
  "reason": "Potentially destructive command detected: '$pattern'",
  "command": "$(echo "$COMMAND" | head -c 200)",
  "message": "This command contains a potentially destructive pattern. Please review carefully before proceeding.",
  "suggestion": "Consider using --dry-run flags or testing in a safe environment first."
}
EOF
    exit 1
  fi
done

# Check for commands without confirmation flags
if echo "$COMMAND" | grep -qE "^rm " && ! echo "$COMMAND" | grep -qE "\-i|\-\-interactive"; then
  cat << EOF
{
  "status": "warning",
  "reason": "Destructive command without interactive flag",
  "command": "$(echo "$COMMAND" | head -c 200)",
  "suggestion": "Consider adding -i flag for interactive confirmation"
}
EOF
  # Warning only - don't block
  exit 0
fi

# Command is safe
echo "{\"status\": \"allowed\", \"checked\": true}"
exit 0
