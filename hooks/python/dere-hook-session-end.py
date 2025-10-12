#!/usr/bin/env python3
import json
import os
import sys

# Add the hooks directory to Python path
hooks_dir = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, hooks_dir)

try:
    from rpc_client import RPCClient
except ImportError:
    # Try different path locations
    import sys

    possible_paths = [
        os.path.join(hooks_dir, "..", "..", "hooks", "python"),
        "/home/justin/.local/bin",
        "/home/justin/.config/dere/.claude/hooks",
    ]
    for path in possible_paths:
        if os.path.exists(os.path.join(path, "rpc_client.py")):
            sys.path.insert(0, path)
            from rpc_client import RPCClient

            break
    else:
        raise ImportError("Could not find rpc_client module")


def main():
    from datetime import datetime

    # Debug logging
    with open("/tmp/dere_session_end_debug.log", "a") as f:
        f.write(
            f"\n--- Session End Hook called at {datetime.now().strftime('%a, %d %b %Y %H:%M:%S %Z')} ---\n"
        )

    # Read JSON from stdin
    try:
        data = json.loads(sys.stdin.read())
        with open("/tmp/dere_session_end_debug.log", "a") as f:
            f.write(f"Received JSON: {data}\n")
    except json.JSONDecodeError as e:
        with open("/tmp/dere_session_end_debug.log", "a") as f:
            f.write(f"Failed to parse JSON input: {e}\n")
        print(f"Failed to parse JSON input: {e}", file=sys.stderr)
        sys.exit(1)

    # Extract exit reason from JSON
    exit_reason = data.get("reason", "normal")

    # Use the dere session ID from environment variable, not Claude Code's session ID
    session_id = int(os.getenv("DERE_SESSION_ID", "0"))

    with open("/tmp/dere_session_end_debug.log", "a") as f:
        f.write(f"Using DERE_SESSION_ID: {session_id}\n")
        f.write(f"Exit reason: {exit_reason}\n")

    rpc = RPCClient()
    result = rpc.end_session(session_id, exit_reason)

    with open("/tmp/dere_session_end_debug.log", "a") as f:
        f.write(f"RPC result: {result}\n")

    # Suppress output to avoid cluttering message history
    print(json.dumps({"suppressOutput": True}))

    if not result:
        sys.exit(1)


if __name__ == "__main__":
    main()
