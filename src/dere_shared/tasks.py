"""Taskwarrior integration for dere context system."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any


def _get_taskwarrior():
    """Get taskwarrior interface using subprocess.

    Returns:
        Tuple of (get_next_tasks_func, available) where available is bool
    """
    try:
        import json
        import subprocess

        def get_next_tasks_wrapper(
            project: str | None = None, tags: list[str] | None = None, limit: int = 5
        ) -> list[dict[str, Any]]:
            """Get next tasks using task export command."""
            try:
                cmd = ["task", "export"]
                if project:
                    cmd.append(f"project:{project}")
                if tags:
                    for tag in tags:
                        cmd.append(f"+{tag}")

                result = subprocess.run(cmd, capture_output=True, text=True, timeout=2)
                if result.returncode != 0:
                    return []

                tasks = json.loads(result.stdout) if result.stdout.strip() else []
                # Filter for pending status explicitly
                tasks = [t for t in tasks if t.get("status") == "pending"]
                # Sort by urgency
                tasks.sort(key=lambda t: t.get("urgency", 0), reverse=True)
                return tasks[:limit]
            except Exception:
                return []

        return get_next_tasks_wrapper, True
    except Exception:
        return None, False


_get_next_tasks, _tw_available = _get_taskwarrior()


def get_task_context(
    limit: int = 5,
    working_dir: str | None = None,
    include_overdue: bool = True,
    include_due_soon: bool = True,
) -> str | None:
    """Get formatted task context for LLM injection.

    Args:
        limit: Maximum number of tasks to include
        working_dir: Optional working directory to filter by project
        include_overdue: Include overdue tasks in context
        include_due_soon: Include tasks due within 24 hours

    Returns:
        Formatted task context string or None if no tasks or unavailable
    """
    if not _tw_available or _get_next_tasks is None:
        return None

    try:
        # Don't filter by project for now - just get all tasks
        # TODO: smarter project detection from git repo or explicit config
        tasks = _get_next_tasks(project=None, limit=limit * 2)  # Get more to filter

        if not tasks:
            return None

        # Categorize tasks
        overdue_tasks = []
        due_today_tasks = []
        due_soon_tasks = []
        high_priority_tasks = []
        other_tasks = []

        import time
        from datetime import datetime, timedelta

        now = time.time()
        today_end = datetime.now().replace(hour=23, minute=59, second=59).timestamp()
        tomorrow_end = (
            (datetime.now() + timedelta(days=1)).replace(hour=23, minute=59, second=59).timestamp()
        )

        for task in tasks:
            due = task.get("due")
            priority = task.get("priority", "")
            urgency = task.get("urgency", 0)

            # Parse due date
            due_timestamp = None
            if due:
                try:
                    # Taskwarrior ISO format: 20251017T040000Z
                    due_dt = datetime.strptime(due, "%Y%m%dT%H%M%SZ")
                    due_timestamp = due_dt.timestamp()
                except (ValueError, TypeError):
                    pass

            # Categorize
            if due_timestamp:
                if due_timestamp < now:
                    overdue_tasks.append(task)
                elif due_timestamp <= today_end:
                    due_today_tasks.append(task)
                elif due_timestamp <= tomorrow_end:
                    due_soon_tasks.append(task)
                elif priority == "H" or urgency >= 10:
                    high_priority_tasks.append(task)
                else:
                    other_tasks.append(task)
            elif priority == "H" or urgency >= 10:
                high_priority_tasks.append(task)
            else:
                other_tasks.append(task)

        # Build context string
        parts = []

        if overdue_tasks and include_overdue:
            overdue_str = ", ".join(
                [f"#{t['id']}: {t['description'][:50]}" for t in overdue_tasks[:3]]
            )
            parts.append(f"Overdue: {overdue_str}")

        if due_today_tasks:
            today_str = ", ".join(
                [f"#{t['id']}: {t['description'][:50]}" for t in due_today_tasks[:3]]
            )
            parts.append(f"Due today: {today_str}")

        if due_soon_tasks and include_due_soon:
            soon_str = ", ".join(
                [f"#{t['id']}: {t['description'][:50]}" for t in due_soon_tasks[:2]]
            )
            parts.append(f"Due soon: {soon_str}")

        if high_priority_tasks:
            high_str = ", ".join(
                [f"#{t['id']}: {t['description'][:50]}" for t in high_priority_tasks[:2]]
            )
            parts.append(f"High priority: {high_str}")

        # Fill remaining slots with other tasks
        remaining_slots = (
            limit
            - len(overdue_tasks[:3])
            - len(due_today_tasks[:3])
            - len(due_soon_tasks[:2])
            - len(high_priority_tasks[:2])
        )
        if remaining_slots > 0 and other_tasks:
            other_str = ", ".join(
                [f"#{t['id']}: {t['description'][:50]}" for t in other_tasks[:remaining_slots]]
            )
            parts.append(f"Other: {other_str}")

        if parts:
            return "Tasks: " + " | ".join(parts)

        return None

    except Exception:
        # Silent failure - task context is supplementary
        return None


def get_task_stats() -> dict[str, int] | None:
    """Get task statistics for status display.

    Returns:
        Dict with counts or None if unavailable
    """
    if not _tw_available or _get_next_tasks is None:
        return None

    try:
        tasks = _get_next_tasks(limit=100)

        overdue_count = 0
        due_today_count = 0
        high_priority_count = 0

        import time
        from datetime import datetime

        now = time.time()
        today_end = datetime.now().replace(hour=23, minute=59, second=59).timestamp()

        for task in tasks:
            due = task.get("due")
            priority = task.get("priority", "")

            if due:
                try:
                    due_dt = datetime.strptime(due, "%Y%m%dT%H%M%SZ")
                    due_timestamp = due_dt.timestamp()

                    if due_timestamp < now:
                        overdue_count += 1
                    elif due_timestamp <= today_end:
                        due_today_count += 1
                except (ValueError, TypeError):
                    pass

            if priority == "H":
                high_priority_count += 1

        return {
            "total": len(tasks),
            "overdue": overdue_count,
            "due_today": due_today_count,
            "high_priority": high_priority_count,
        }

    except Exception:
        return None
