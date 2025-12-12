#!/usr/bin/env python3
"""
Dynamic context injection hook for dere.
Injects fresh time, weather, and activity context with every user message.
Uses HTTP API to daemon - no local imports needed.
"""

import json
import os
import sys
from datetime import datetime
from pathlib import Path

DEFAULT_DAEMON_URL = "http://localhost:6969/api"


def log_error(message):
    """Centralized error logging with timestamp"""
    try:
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with open("/tmp/dere_context_hook.log", "a") as f:
            f.write(f"[{timestamp}] {message}\n")
    except Exception:
        pass


def _load_initial_documents(session_id: int | None, daemon_url: str) -> None:
    """Load documents specified via CLI flags on session start."""
    if not session_id:
        return

    state_file = Path(f"/tmp/dere_docs_loaded_{session_id}")
    if state_file.exists():
        return

    with_docs = os.getenv("DERE_WITH_DOCS", "")
    with_tags = os.getenv("DERE_WITH_TAGS", "")

    if not with_docs and not with_tags:
        return

    try:
        import requests

        user_id = os.getenv("USER") or os.getenv("USERNAME") or "default"

        request_data = {}
        if with_docs:
            doc_ids = [int(d.strip()) for d in with_docs.split(",") if d.strip()]
            request_data["doc_ids"] = doc_ids
        if with_tags:
            tags = [t.strip() for t in with_tags.split(",") if t.strip()]
            request_data["tags"] = tags

        response = requests.post(
            f"{daemon_url}/sessions/{session_id}/documents/load",
            params={"user_id": user_id},
            json=request_data,
            timeout=10,
        )
        response.raise_for_status()

        with open(state_file, "w") as f:
            f.write("")

        log_error(f"Loaded documents for session {session_id}: {request_data}")
    except Exception as e:
        log_error(f"Failed to load initial documents: {e}")


def get_context_from_daemon(daemon_url: str, session_id: int | None) -> str | None:
    """Fetch context from daemon API instead of importing local modules."""
    try:
        import requests

        params = {}
        if session_id:
            params["session_id"] = session_id

        response = requests.get(
            f"{daemon_url}/context",
            params=params,
            timeout=5,
        )
        response.raise_for_status()
        data = response.json()
        return data.get("context")
    except Exception as e:
        log_error(f"Failed to get context from daemon: {e}")
        return None


def main():
    try:
        stdin_data = sys.stdin.read()
        if not stdin_data:
            sys.exit(0)
        json.loads(stdin_data)
    except json.JSONDecodeError as e:
        log_error(f"JSON decode error from stdin: {e}")
        sys.exit(0)
    except Exception as e:
        log_error(f"Error reading input: {e}")
        sys.exit(0)

    try:
        daemon_url = os.getenv("DERE_DAEMON_URL", DEFAULT_DAEMON_URL)
        session_id_str = os.getenv("DERE_SESSION_ID")
        session_id = int(session_id_str) if session_id_str else None

        _load_initial_documents(session_id, daemon_url)

        context_str = get_context_from_daemon(daemon_url, session_id)
        if context_str:
            output = {
                "hookSpecificOutput": {
                    "hookEventName": "UserPromptSubmit",
                    "additionalContext": f"\n{context_str}\n",
                },
                "suppressOutput": True,
            }
            print(json.dumps(output))
        else:
            print(json.dumps({"suppressOutput": True}))
    except Exception as e:
        log_error(f"Context gathering error: {e}")
        print(json.dumps({"suppressOutput": True}))

    sys.exit(0)


if __name__ == "__main__":
    main()
