#!/usr/bin/env python3
"""Dere personality hook for Claude CLI integration."""

import json
import os
import sys
from typing import NamedTuple

# Add the hooks directory to Python path for rpc_client import
hooks_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, hooks_dir)

from rpc_client import RPCClient


class HookArgs(NamedTuple):
    """Parsed hook arguments."""

    session_id: int
    personality: str
    project_path: str
    prompt: str


def parse_stdin_args() -> HookArgs | None:
    """Parse arguments from stdin (JSON format).

    Returns:
        HookArgs if successful, None if should skip hook
    """
    try:
        stdin_data = sys.stdin.read().strip()
        if not stdin_data:
            # No stdin data, use defaults (empty hook)
            return HookArgs(0, "", "", "")

        data = json.loads(stdin_data)

        # Only process if DERE_PERSONALITY is set (i.e., this is a dere session)
        personality = os.getenv("DERE_PERSONALITY")
        if not personality:
            return None  # Skip - not a dere session

        # Use the dere session ID from environment variable
        session_id = int(os.getenv("DERE_SESSION_ID", "0"))
        project_path = data.get("cwd", "")
        prompt = data.get("prompt", "")

        return HookArgs(session_id, personality, project_path, prompt)
    except Exception:
        sys.exit(1)


def parse_cli_args() -> HookArgs:
    """Parse arguments from command line.

    Returns:
        HookArgs with parsed values

    Raises:
        SystemExit if arguments are invalid
    """
    if len(sys.argv) < 5:
        print(
            "Usage: dere-hook.py <session_id> <personality> <project_path> <prompt>",
            file=sys.stderr,
        )
        sys.exit(1)

    return HookArgs(
        session_id=int(sys.argv[1]),
        personality=sys.argv[2],
        project_path=sys.argv[3],
        prompt=sys.argv[4],
    )


def parse_args() -> HookArgs | None:
    """Parse hook arguments from stdin or command line.

    Returns:
        HookArgs if successful, None if should skip hook
    """
    if len(sys.argv) == 1:
        # Read from stdin (Claude Code format)
        return parse_stdin_args()
    else:
        # Traditional CLI arguments
        return parse_cli_args()


def main():
    """Main hook entry point."""
    args = parse_args()
    if args is None:
        sys.exit(0)  # Skip hook for non-dere sessions

    # Call RPC to capture conversation
    rpc = RPCClient()
    result = rpc.capture_conversation(
        args.session_id, args.personality, args.project_path, args.prompt
    )

    # Always suppress output to avoid cluttering message history
    print(json.dumps({"suppressOutput": True}))

    if not result:
        sys.exit(1)


if __name__ == "__main__":
    main()
