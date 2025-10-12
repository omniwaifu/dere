#!/usr/bin/env python3
"""
Dynamic context injection hook for dere.
Injects fresh time, weather, and activity context with every user message.
"""

import json
import os
import sys
from datetime import datetime
from pathlib import Path

# Add both installed and development paths
hook_dir = Path(__file__).parent.parent.parent
sys.path.insert(0, str(Path.home() / ".local/share/dere/src"))
sys.path.insert(0, str(hook_dir / "src"))

from dere_shared.context import get_full_context  # noqa: E402


def log_error(message):
    """Centralized error logging with timestamp"""
    try:
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with open("/tmp/dere_context_hook.log", "a") as f:
            f.write(f"[{timestamp}] {message}\n")
    except Exception:
        pass  # Don't let logging errors break the hook


def main():
    if os.getenv("DERE_CONTEXT") != "true":
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
        # Get session ID from environment
        session_id_str = os.getenv("DERE_SESSION_ID")
        session_id = int(session_id_str) if session_id_str else None

        context_str = get_full_context(session_id=session_id)
        if context_str:
            print(f"\n{context_str}\n")
    except Exception as e:
        log_error(f"Context gathering error: {e}")

    sys.exit(0)


if __name__ == "__main__":
    main()
