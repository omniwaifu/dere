#!/usr/bin/env python3
"""PostToolUse hook to inject compressed personality reminder after high-output tools."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path


def estimate_tokens(text: str) -> int:
    """Rough token estimate: ~4 chars per token."""
    return len(text) // 4


def get_compressed_reminder(prompt: str) -> str:
    """Extract compressed reminder from personality prompt.

    Takes first sentence or first ~50 chars as a reminder.
    """
    # Try to get first sentence
    lines = prompt.strip().split("\n")
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        # Found first non-header line, use it
        if "." in line:
            # Get up to first period
            first_sentence = line.split(".")[0] + "."
            return first_sentence
        return line[:100]  # Fallback to first 100 chars

    # Fallback: just return first 50 chars of entire prompt
    return prompt[:50]


def main() -> None:
    """Inject compressed personality reminder after high-output tools."""
    # Read hook input from stdin
    try:
        hook_input = json.loads(sys.stdin.read())
    except Exception:
        print(json.dumps({}))
        return

    # Check if personality is set
    personality = os.environ.get("DERE_PERSONALITY")
    if not personality:
        print(json.dumps({}))
        return

    # Get tool name and result
    tool_name = hook_input.get("tool_name", "")
    tool_result = hook_input.get("tool_result", "")

    # Only inject for high-output tools
    high_output_tools = {"Read", "Bash", "Grep"}
    if tool_name not in high_output_tools:
        print(json.dumps({}))
        return

    # Check output size
    output_tokens = estimate_tokens(str(tool_result))
    token_threshold = 500

    if output_tokens < token_threshold:
        print(json.dumps({}))
        return

    # Load personality and create compressed reminder
    try:
        from dere_shared.personalities import PersonalityLoader

        # Get config dir from env or default
        config_dir_str = os.environ.get("CLAUDE_CONFIG_DIR")
        if config_dir_str:
            config_dir = Path(config_dir_str)
        else:
            config_dir = Path.home() / ".config" / "dere"

        loader = PersonalityLoader(config_dir)

        # Handle comma-separated personalities, use first one
        personality_names = [p.strip() for p in personality.split(",")]
        if not personality_names:
            print(json.dumps({}))
            return

        # Load the personality
        pers = loader.load(personality_names[0])

        # Create compressed reminder
        compressed = get_compressed_reminder(pers.prompt_content)

        # Output compressed reminder as additionalContext
        output = {"additionalContext": compressed}
        print(json.dumps(output))

    except Exception:
        # Silent fail - don't break tool execution if personality loading fails
        print(json.dumps({}))


if __name__ == "__main__":
    main()
