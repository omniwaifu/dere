#!/usr/bin/env python3
"""
Task context injection hook for dere.
Injects top taskwarrior tasks into every user message.
"""

import json
import os
import sys
from datetime import datetime
from pathlib import Path

# Add src directory to path to find dere_shared
src_dir = Path(__file__).parent.parent.parent.parent
sys.path.insert(0, str(src_dir))

from dere_shared.tasks import get_task_context


def log_error(message):
    """Centralized error logging with timestamp"""
    try:
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with open("/tmp/dere_task_hook.log", "a") as f:
            f.write(f"[{timestamp}] {message}\n")
    except Exception:
        pass


def main():
    # Check if tasks should be injected
    if os.getenv("DERE_TASKS") != "true":
        sys.exit(0)

    try:
        stdin_data = sys.stdin.read()
        if not stdin_data:
            sys.exit(0)

        json.loads(stdin_data)  # Validate JSON but don't need the data
    except json.JSONDecodeError as e:
        log_error(f"JSON decode error from stdin: {e}")
        sys.exit(0)
    except Exception as e:
        log_error(f"Error reading input: {e}")
        sys.exit(0)

    try:
        # Get working directory from environment if available
        working_dir = os.getenv("PWD")

        # Get task context
        task_context = get_task_context(
            limit=5,
            working_dir=working_dir,
            include_overdue=True,
            include_due_soon=True,
        )

        if task_context:
            # Output JSON with additionalContext to inject context silently
            output = {
                "hookSpecificOutput": {
                    "hookEventName": "UserPromptSubmit",
                    "additionalContext": f"\n{task_context}\n",
                },
                "suppressOutput": True,
            }
            print(json.dumps(output))
        else:
            # No context to add, just suppress output
            print(json.dumps({"suppressOutput": True}))
    except Exception as e:
        log_error(f"Task context gathering error: {e}")
        # Suppress output even on error
        print(json.dumps({"suppressOutput": True}))

    sys.exit(0)


if __name__ == "__main__":
    main()
