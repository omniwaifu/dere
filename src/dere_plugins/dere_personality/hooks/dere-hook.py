#!/usr/bin/env python3
import os
import sys

# Add the hooks directory to Python path for rpc_client import
hooks_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, hooks_dir)

from rpc_client import RPCClient


def main():
    # Debug: log all arguments
    with open("/tmp/dere_hook_debug.log", "a") as f:
        f.write(f"Hook called with args: {sys.argv}\n")

    # Read from stdin if no arguments provided (dere might pass data via stdin)
    if len(sys.argv) == 1:
        try:
            import json

            stdin_data = sys.stdin.read().strip()
            with open("/tmp/dere_hook_debug.log", "a") as f:
                f.write(f"Reading from stdin: {stdin_data}\n")

            if stdin_data:
                data = json.loads(stdin_data)

                # Only process if DERE_PERSONALITY is set (i.e., this is a dere session)
                personality = os.getenv("DERE_PERSONALITY")
                if not personality:
                    with open("/tmp/dere_hook_debug.log", "a") as f:
                        f.write("Skipping - not a dere session (no DERE_PERSONALITY)\n")
                    sys.exit(0)

                # Use the dere session ID from environment variable, not Claude Code's session ID
                session_id = int(os.getenv("DERE_SESSION_ID", "0"))

                project_path = data.get("cwd", "")
                prompt = data.get("prompt", "")
            else:
                with open("/tmp/dere_hook_debug.log", "a") as f:
                    f.write("No stdin data, using defaults\n")
                session_id = 0
                personality = ""
                project_path = ""
                prompt = ""
        except Exception as e:
            with open("/tmp/dere_hook_debug.log", "a") as f:
                f.write(f"Error reading stdin: {e}\n")
            sys.exit(1)
    elif len(sys.argv) >= 5:
        # Traditional argument parsing
        session_id = int(sys.argv[1])
        personality = sys.argv[2]
        project_path = sys.argv[3]
        prompt = sys.argv[4]
    else:
        with open("/tmp/dere_hook_debug.log", "a") as f:
            f.write(f"ERROR: Not enough args. Got {len(sys.argv)}, need 5\n")
        print(
            "Usage: dere-hook.py <session_id> <personality> <project_path> <prompt>",
            file=sys.stderr,
        )
        sys.exit(1)

    with open("/tmp/dere_hook_debug.log", "a") as f:
        f.write(
            f"Calling RPC with session_id={session_id}, personality={personality}, project_path={project_path}, prompt='{prompt}'\n"
        )

    rpc = RPCClient()
    result = rpc.capture_conversation(session_id, personality, project_path, prompt)

    with open("/tmp/dere_hook_debug.log", "a") as f:
        f.write(f"RPC result: {result}\n")

    # Always suppress output to avoid cluttering message history
    print(json.dumps({"suppressOutput": True}))

    if not result:
        sys.exit(1)


if __name__ == "__main__":
    main()
