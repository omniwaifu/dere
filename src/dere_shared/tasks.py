"""Taskwarrior integration for dere context system."""

from __future__ import annotations

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


def _detect_project_from_dir(working_dir: str) -> str | None:
    """Detect project name from working directory.

    Tries to extract project name from:
    1. Git remote URL (e.g., github.com/user/repo-name -> repo-name)
    2. Directory name as fallback

    Args:
        working_dir: Path to working directory

    Returns:
        Project name or None if not detected
    """
    import subprocess
    from pathlib import Path

    try:
        path = Path(working_dir)
        if not path.exists():
            return None

        # Try to get git remote URL
        try:
            result = subprocess.run(
                ["git", "-C", str(path), "remote", "get-url", "origin"],
                capture_output=True,
                text=True,
                timeout=2,
            )
            if result.returncode == 0:
                remote_url = result.stdout.strip()
                # Extract repo name from URL
                # Examples:
                # - https://github.com/user/repo-name.git -> repo-name
                # - git@github.com:user/repo-name.git -> repo-name
                if remote_url:
                    # Remove .git suffix
                    if remote_url.endswith(".git"):
                        remote_url = remote_url[:-4]
                    # Get last path component
                    repo_name = remote_url.rstrip("/").split("/")[-1]
                    # Also handle git@host:user/repo format
                    if ":" in repo_name and "/" in repo_name:
                        repo_name = repo_name.split("/")[-1]
                    if repo_name:
                        return repo_name
        except (subprocess.TimeoutExpired, FileNotFoundError):
            pass

        # Fallback: use directory name
        return path.name

    except Exception:
        return None


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
        # Detect project from working_dir if provided
        project = None
        if working_dir:
            project = _detect_project_from_dir(working_dir)
            if project:
                from loguru import logger

                logger.debug(f"Detected project '{project}' from {working_dir}")

        tasks = _get_next_tasks(project=project, limit=limit * 2)  # Get more to filter

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
