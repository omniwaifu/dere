"""Git operations for swarm branch management."""

from __future__ import annotations

import asyncio

from loguru import logger


async def _run_git(working_dir: str, *args: str) -> tuple[int, str, str]:
    """Run git command and return (returncode, stdout, stderr)."""
    proc = await asyncio.create_subprocess_exec(
        "git",
        *args,
        cwd=working_dir,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    return proc.returncode, stdout.decode().strip(), stderr.decode().strip()


async def get_current_branch(working_dir: str) -> str:
    """Get current branch name."""
    returncode, stdout, stderr = await _run_git(
        working_dir, "rev-parse", "--abbrev-ref", "HEAD"
    )
    if returncode != 0:
        raise RuntimeError(f"Failed to get current branch: {stderr}")
    return stdout


async def branch_exists(working_dir: str, branch_name: str) -> bool:
    """Check if a branch exists."""
    returncode, _, _ = await _run_git(
        working_dir, "show-ref", "--verify", "--quiet", f"refs/heads/{branch_name}"
    )
    return returncode == 0


async def create_branch(
    working_dir: str,
    branch_name: str,
    base: str = "HEAD",
) -> str:
    """Create a new branch from base (does not checkout).

    Returns the created branch name.
    """
    # Check if branch already exists
    if await branch_exists(working_dir, branch_name):
        raise RuntimeError(f"Branch '{branch_name}' already exists")

    returncode, _, stderr = await _run_git(
        working_dir, "branch", branch_name, base
    )
    if returncode != 0:
        raise RuntimeError(f"Failed to create branch '{branch_name}': {stderr}")

    logger.info("Created branch '{}' from '{}'", branch_name, base)
    return branch_name


async def checkout_branch(working_dir: str, branch_name: str) -> None:
    """Checkout an existing branch."""
    returncode, _, stderr = await _run_git(working_dir, "checkout", branch_name)
    if returncode != 0:
        raise RuntimeError(f"Failed to checkout branch '{branch_name}': {stderr}")


async def create_and_checkout_branch(
    working_dir: str,
    branch_name: str,
    base: str = "HEAD",
) -> str:
    """Create and checkout a new branch."""
    returncode, _, stderr = await _run_git(
        working_dir, "checkout", "-b", branch_name, base
    )
    if returncode != 0:
        raise RuntimeError(f"Failed to create and checkout branch '{branch_name}': {stderr}")

    logger.info("Created and checked out branch '{}' from '{}'", branch_name, base)
    return branch_name


async def merge_branch(
    working_dir: str,
    source_branch: str,
    target_branch: str,
    no_ff: bool = True,
    message: str | None = None,
) -> tuple[bool, str | None]:
    """Merge source branch into target branch.

    Returns (success, error_message).
    """
    # First checkout target branch
    await checkout_branch(working_dir, target_branch)

    # Build merge command
    args = ["merge", source_branch]
    if no_ff:
        args.append("--no-ff")
    if message:
        args.extend(["-m", message])

    returncode, stdout, stderr = await _run_git(working_dir, *args)

    if returncode != 0:
        # Check if it's a merge conflict
        if "CONFLICT" in stdout or "CONFLICT" in stderr:
            # Abort the merge
            await _run_git(working_dir, "merge", "--abort")
            return False, f"Merge conflict: {stderr or stdout}"
        return False, stderr or stdout

    logger.info("Merged '{}' into '{}'", source_branch, target_branch)
    return True, None


async def delete_branch(working_dir: str, branch_name: str, force: bool = False) -> None:
    """Delete a branch."""
    flag = "-D" if force else "-d"
    returncode, _, stderr = await _run_git(working_dir, "branch", flag, branch_name)
    if returncode != 0:
        raise RuntimeError(f"Failed to delete branch '{branch_name}': {stderr}")


async def get_branch_diff_stat(
    working_dir: str,
    branch: str,
    base: str = "main",
) -> str:
    """Get diff stat between branch and base."""
    returncode, stdout, stderr = await _run_git(
        working_dir, "diff", "--stat", f"{base}...{branch}"
    )
    if returncode != 0:
        raise RuntimeError(f"Failed to get diff stat: {stderr}")
    return stdout


async def has_uncommitted_changes(working_dir: str) -> bool:
    """Check if working directory has uncommitted changes."""
    returncode, stdout, _ = await _run_git(working_dir, "status", "--porcelain")
    return returncode == 0 and bool(stdout.strip())


async def stash_changes(working_dir: str, message: str | None = None) -> bool:
    """Stash any uncommitted changes. Returns True if something was stashed."""
    if not await has_uncommitted_changes(working_dir):
        return False

    args = ["stash", "push"]
    if message:
        args.extend(["-m", message])

    returncode, _, stderr = await _run_git(working_dir, *args)
    if returncode != 0:
        raise RuntimeError(f"Failed to stash changes: {stderr}")

    return True


async def stash_pop(working_dir: str) -> None:
    """Pop the most recent stash."""
    returncode, _, stderr = await _run_git(working_dir, "stash", "pop")
    if returncode != 0:
        raise RuntimeError(f"Failed to pop stash: {stderr}")
