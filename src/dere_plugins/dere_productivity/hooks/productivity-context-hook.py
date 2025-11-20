#!/usr/bin/env python3
"""
Productivity context injection hook for dere.
Injects tasks, activity, and calendar context into every user message.
"""

import json
import os
import sys
from datetime import datetime
from pathlib import Path

# Add src directory to path to find dere_shared
src_dir = Path(__file__).parent.parent.parent.parent
sys.path.insert(0, str(src_dir))

from dere_shared.activitywatch import get_activity_context
from dere_shared.config import load_dere_config
from dere_shared.tasks import get_task_context


def log_error(message):
    """Centralized error logging with timestamp"""
    try:
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with open("/tmp/dere_productivity_hook.log", "a") as f:
            f.write(f"[{timestamp}] {message}\n")
    except Exception:
        pass


def main():
    # Check if productivity context should be injected
    if os.getenv("DERE_PRODUCTIVITY") != "true":
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
        config = load_dere_config()
        context_parts = []

        # Task context (from Taskwarrior)
        try:
            if config.get("context", {}).get("tasks", False):
                # Don't filter by project in productivity mode - show ALL tasks
                task_ctx = get_task_context(
                    limit=5,
                    working_dir=None,
                    include_overdue=True,
                    include_due_soon=True,
                )
                if task_ctx:
                    context_parts.append(task_ctx)
                    context_parts.append("Tool: taskwarrior available via MCP")
                else:
                    log_error("Task context: No tasks returned from get_task_context()")
        except Exception as e:
            log_error(f"Task context error: {e}")
            import traceback
            log_error(traceback.format_exc())

        # Activity context (from ActivityWatch)
        try:
            if config.get("context", {}).get("activity", False) or config.get("context", {}).get("media_player", False):
                activity_ctx = get_activity_context(config)
                if activity_ctx:
                    if activity_ctx.get("recent_apps"):
                        activity_str = "Recent activity: " + ", ".join(activity_ctx["recent_apps"])
                        context_parts.append(activity_str)
                    elif activity_ctx.get("status"):
                        context_parts.append(f"User status: {activity_ctx['status']}")
        except Exception as e:
            log_error(f"Activity context error: {e}")
            import traceback
            log_error(traceback.format_exc())

        # Calendar context
        # NOTE: Calendar is available via MCP (google-calendar server) but can't be
        # injected via hook since hooks can't call MCP tools. Query calendar directly via MCP.

        if context_parts:
            productivity_context = "\n".join(context_parts)
            output = {
                "hookSpecificOutput": {
                    "hookEventName": "UserPromptSubmit",
                    "additionalContext": f"\n[Productivity Context]\n{productivity_context}\n",
                },
                "suppressOutput": True,
            }
            print(json.dumps(output))
        else:
            print(json.dumps({"suppressOutput": True}))

    except Exception as e:
        log_error(f"Productivity context gathering error: {e}")
        print(json.dumps({"suppressOutput": True}))

    sys.exit(0)


if __name__ == "__main__":
    main()
