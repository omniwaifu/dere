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


def _load_initial_documents(session_id: int | None) -> None:
    """Load documents specified via CLI flags on session start."""
    if not session_id:
        return

    # Check if we've already loaded documents for this session
    state_file = Path(f"/tmp/dere_docs_loaded_{session_id}")
    if state_file.exists():
        return

    # Check for document IDs to load
    with_docs = os.getenv("DERE_WITH_DOCS", "")
    with_tags = os.getenv("DERE_WITH_TAGS", "")

    if not with_docs and not with_tags:
        return

    try:
        import requests

        daemon_url = "http://localhost:8787"
        user_id = os.getenv("USER") or os.getenv("USERNAME") or "default"

        # Prepare load request
        request_data = {}
        if with_docs:
            doc_ids = [int(d.strip()) for d in with_docs.split(",") if d.strip()]
            request_data["doc_ids"] = doc_ids
        if with_tags:
            tags = [t.strip() for t in with_tags.split(",") if t.strip()]
            request_data["tags"] = tags

        # Load documents
        response = requests.post(
            f"{daemon_url}/sessions/{session_id}/documents/load",
            params={"user_id": user_id},
            json=request_data,
            timeout=10,
        )
        response.raise_for_status()

        # Mark as loaded
        with open(state_file, "w") as f:
            f.write("")

        log_error(f"Loaded documents for session {session_id}: {request_data}")
    except Exception as e:
        log_error(f"Failed to load initial documents: {e}")


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

        # Load documents on first message (if specified)
        _load_initial_documents(session_id)

        context_str = get_full_context(session_id=session_id)
        if context_str:
            # Output JSON with additionalContext to inject context silently
            output = {
                "hookSpecificOutput": {
                    "hookEventName": "UserPromptSubmit",
                    "additionalContext": f"\n{context_str}\n",
                },
                "suppressOutput": True,
            }
            print(json.dumps(output))
        else:
            # No context to add, just suppress output
            print(json.dumps({"suppressOutput": True}))
    except Exception as e:
        log_error(f"Context gathering error: {e}")
        # Suppress output even on error
        print(json.dumps({"suppressOutput": True}))

    sys.exit(0)


if __name__ == "__main__":
    main()
