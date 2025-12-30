#!/usr/bin/env python3
"""
Session-start context injection hook for dere.
Injects adaptive KG context on first session start:
- Code sessions: recent work in project + git commits
- Conversational sessions: recent discussions and entities
"""

import json
import os
import sys
from datetime import datetime

DEFAULT_DAEMON_URL = "http://localhost:6969/api"


def log_error(message):
    """Centralized error logging with timestamp"""
    try:
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with open("/tmp/dere_session_context_hook.log", "a") as f:
            f.write(f"[{timestamp}] {message}\n")
    except Exception:
        pass


def get_session_start_context(
    daemon_url: str,
    session_id: int,
    user_id: str,
    working_dir: str | None,
    medium: str | None,
) -> str | None:
    """Fetch session-start context from daemon API."""
    try:
        import requests

        payload = {
            "session_id": session_id,
            "user_id": user_id,
        }
        if working_dir:
            payload["working_dir"] = working_dir
        if medium:
            payload["medium"] = medium

        response = requests.post(
            f"{daemon_url}/context/build_session_start",
            json=payload,
            timeout=10,
        )
        response.raise_for_status()
        data = response.json()

        if data.get("status") in ["ready", "cached"]:
            return data.get("context")

        log_error(f"Session-start context not ready: {data.get('status')}")
        return None
    except Exception as e:
        log_error(f"Failed to get session-start context from daemon: {e}")
        return None


def main():
    try:
        stdin_data = sys.stdin.read()
        if not stdin_data:
            sys.exit(0)
        stdin_json = json.loads(stdin_data)
    except json.JSONDecodeError as e:
        log_error(f"JSON decode error from stdin: {e}")
        sys.exit(0)
    except Exception as e:
        log_error(f"Error reading input: {e}")
        sys.exit(0)

    try:
        daemon_url = os.getenv("DERE_DAEMON_URL", DEFAULT_DAEMON_URL)
        session_id_str = os.getenv("DERE_SESSION_ID")
        user_id = os.getenv("USER") or os.getenv("USERNAME") or "default"

        if not session_id_str:
            log_error("No DERE_SESSION_ID environment variable, skipping session-start context")
            print(json.dumps({"suppressOutput": True}))
            sys.exit(0)

        session_id = int(session_id_str)

        # Extract working_dir and medium from stdin (fallback for session creation)
        # Prefer environment variables over stdin for accuracy
        working_dir = os.getenv("PWD") or stdin_json.get("cwd")
        medium = stdin_json.get("medium") or "cli"

        # Only pass working_dir if it's non-empty and a valid directory
        if working_dir and not os.path.isdir(working_dir):
            log_error(f"Working dir {working_dir} is not a directory, ignoring")
            working_dir = None

        context_str = get_session_start_context(
            daemon_url, session_id, user_id, working_dir, medium
        )
        if context_str and context_str.strip():
            output = {
                "hookSpecificOutput": {
                    "hookEventName": "SessionStart",
                    "additionalContext": f"\n{context_str}\n",
                },
                "suppressOutput": True,
            }
            log_error(f"Injected session-start context for session {session_id}")
            print(json.dumps(output))
        else:
            # Silent fail - no context available
            print(json.dumps({"suppressOutput": True}))
    except Exception as e:
        log_error(f"Session-start context error: {e}")
        print(json.dumps({"suppressOutput": True}))

    sys.exit(0)


if __name__ == "__main__":
    main()
