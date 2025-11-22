#!/usr/bin/env python3
"""PostToolUse hook to inject personality after every tool call."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path


def main() -> None:
    """Inject personality prompt after tool execution."""
    # Check if personality is set
    personality = os.environ.get("DERE_PERSONALITY")
    if not personality:
        # No personality, output empty JSON
        print(json.dumps({}))
        return

    # Load personality from TOML
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

        # Output personality prompt as additionalContext
        output = {"additionalContext": pers.prompt_content}
        print(json.dumps(output))

    except Exception:
        # Silent fail - don't break tool execution if personality loading fails
        print(json.dumps({}))


if __name__ == "__main__":
    main()
