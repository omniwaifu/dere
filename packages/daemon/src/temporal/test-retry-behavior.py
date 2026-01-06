#!/usr/bin/env python3
"""
Test retry behavior of exploration workflow.

Verifies that killing the worker mid-exploration doesn't orphan the task,
and the workflow resumes correctly when worker restarts.
"""

import subprocess
import time
import signal
import sys
import os
import json
import psycopg
from pathlib import Path

# Config
DAEMON_DIR = Path(__file__).parent.parent.parent
PROJECT_ROOT = DAEMON_DIR.parent.parent
WORKER_SCRIPT = DAEMON_DIR / "src/temporal/worker.ts"
DB_URL = os.environ.get("DATABASE_URL", "postgresql://postgres:dere@localhost:5433/dere")

# How long to wait before killing worker (should be during runExploration)
KILL_AFTER_SECONDS = 15
# How long to wait for workflow to complete after restart
MAX_WAIT_SECONDS = 180


def log(msg: str, level: str = "INFO"):
    colors = {"INFO": "\033[36m", "OK": "\033[32m", "WARN": "\033[33m", "ERR": "\033[31m"}
    reset = "\033[0m"
    print(f"{colors.get(level, '')}{level}{reset} {msg}")


def run_sql(query: str, fetch: bool = False):
    """Run a SQL query and optionally fetch results."""
    with psycopg.connect(DB_URL) as conn:
        with conn.cursor() as cur:
            cur.execute(query)
            if fetch:
                return cur.fetchall()
            conn.commit()


def ensure_test_task() -> int:
    """Create a test curiosity task if none exist, return task ID."""
    rows = run_sql(
        """
        SELECT id, title FROM project_tasks
        WHERE task_type = 'curiosity' AND status = 'ready'
        LIMIT 1
        """,
        fetch=True,
    )

    if rows:
        task_id, title = rows[0]
        log(f"Using existing task [{task_id}]: {title}")
        return task_id

    # Create a new test task
    run_sql(
        """
        INSERT INTO project_tasks (
            working_dir, title, description, task_type, priority, status,
            extra, created_at, updated_at, attempt_count
        ) VALUES (
            '/tmp',
            'What is the history of workflow orchestration systems?',
            'Test task for retry behavior verification',
            'curiosity', 10, 'ready',
            '{"curiosity_type": "test", "source_context": "retry test"}'::jsonb,
            now(), now(), 0
        )
        """
    )

    rows = run_sql(
        "SELECT id FROM project_tasks WHERE title LIKE '%workflow orchestration%' ORDER BY id DESC LIMIT 1",
        fetch=True,
    )
    task_id = rows[0][0]
    log(f"Created test task [{task_id}]")
    return task_id


def get_task_status(task_id: int) -> tuple[str, str | None]:
    """Get task status and any error."""
    rows = run_sql(
        f"SELECT status, last_error FROM project_tasks WHERE id = {task_id}",
        fetch=True,
    )
    if rows:
        return rows[0][0], rows[0][1]
    return "not_found", None


def start_worker() -> subprocess.Popen:
    """Start the temporal worker."""
    log("Starting worker...")
    env = os.environ.copy()
    proc = subprocess.Popen(
        ["bun", "run", str(WORKER_SCRIPT)],
        cwd=str(DAEMON_DIR),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        env=env,
        text=True,
    )
    # Wait for worker to be ready
    time.sleep(3)
    log("Worker started", "OK")
    return proc


def start_workflow(task_id: int) -> subprocess.Popen:
    """Start an exploration workflow for the given task."""
    log(f"Starting workflow for task {task_id}...")

    # Use a simple inline script to start the workflow
    script = f"""
    import {{ startExplorationWorkflow }} from "./starter.js";
    const result = await startExplorationWorkflow({{
        taskId: {task_id},
        model: "claude-sonnet-4-5"
    }});
    console.log(JSON.stringify(result));
    """

    proc = subprocess.Popen(
        ["bun", "-e", script],
        cwd=str(DAEMON_DIR / "src/temporal"),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    return proc


def wait_for_workflow_start(task_id: int, timeout: int = 30) -> bool:
    """Wait for task to transition to in_progress."""
    log("Waiting for workflow to claim task...")
    start = time.time()
    while time.time() - start < timeout:
        status, _ = get_task_status(task_id)
        if status == "in_progress":
            log("Task claimed by workflow", "OK")
            return True
        time.sleep(1)
    log("Timeout waiting for task claim", "ERR")
    return False


def wait_for_completion(task_id: int, timeout: int = MAX_WAIT_SECONDS) -> bool:
    """Wait for task to complete."""
    log(f"Waiting for task completion (max {timeout}s)...")
    start = time.time()
    while time.time() - start < timeout:
        status, error = get_task_status(task_id)
        if status == "done":
            log("Task completed successfully!", "OK")
            return True
        if status == "ready":
            # Task was released (failure case)
            log(f"Task was released back to ready: {error}", "WARN")
            return False
        elapsed = int(time.time() - start)
        if elapsed % 10 == 0:
            log(f"  Still waiting... status={status}, elapsed={elapsed}s")
        time.sleep(2)
    log(f"Timeout after {timeout}s", "ERR")
    return False


def main():
    log("=" * 50)
    log("Temporal Retry Behavior Test")
    log("=" * 50)

    # Step 1: Ensure we have a test task
    task_id = ensure_test_task()
    initial_status, _ = get_task_status(task_id)
    log(f"Initial task status: {initial_status}")

    if initial_status != "ready":
        log("Task not in ready state, resetting...")
        run_sql(f"UPDATE project_tasks SET status = 'ready', started_at = NULL WHERE id = {task_id}")

    # Step 2: Start worker
    worker = start_worker()

    try:
        # Step 3: Start workflow (in background - we don't wait for result)
        workflow_proc = start_workflow(task_id)

        # Step 4: Wait for task to be claimed
        if not wait_for_workflow_start(task_id):
            log("Failed to start workflow", "ERR")
            return 1

        # Step 5: Wait a bit for exploration to be in progress, then kill worker
        log(f"Waiting {KILL_AFTER_SECONDS}s before killing worker...")
        time.sleep(KILL_AFTER_SECONDS)

        status_before_kill, _ = get_task_status(task_id)
        log(f"Task status before kill: {status_before_kill}")

        log("Killing worker...")
        worker.send_signal(signal.SIGTERM)
        worker.wait(timeout=5)
        log("Worker killed", "OK")

        # Step 6: Check task is still in_progress (not orphaned to ready)
        status_after_kill, _ = get_task_status(task_id)
        log(f"Task status after kill: {status_after_kill}")

        if status_after_kill == "ready":
            log("Task was incorrectly released! Bug in cleanup logic.", "ERR")
            return 1

        # Step 7: Wait a moment, then restart worker
        log("Waiting 3s before restarting worker...")
        time.sleep(3)

        worker = start_worker()

        # Step 8: Wait for workflow to complete
        if wait_for_completion(task_id):
            log("=" * 50)
            log("TEST PASSED: Workflow survived worker restart", "OK")
            log("=" * 50)

            # Show final task state
            rows = run_sql(
                f"""
                SELECT status, outcome, extra->>'satisfaction_level' as confidence
                FROM project_tasks WHERE id = {task_id}
                """,
                fetch=True,
            )
            if rows:
                status, outcome, confidence = rows[0]
                log(f"Final: status={status}, outcome={outcome}, confidence={confidence}")

            return 0
        else:
            log("=" * 50)
            log("TEST FAILED: Workflow did not complete", "ERR")
            log("=" * 50)
            return 1

    finally:
        # Cleanup
        if worker.poll() is None:
            worker.terminate()
            worker.wait(timeout=5)
        if 'workflow_proc' in dir() and workflow_proc.poll() is None:
            workflow_proc.terminate()


if __name__ == "__main__":
    sys.exit(main())
