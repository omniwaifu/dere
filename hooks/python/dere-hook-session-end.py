#!/usr/bin/env python3
import sys
import os

# Add the hooks directory to Python path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from rpc_client import RPCClient

def main():
    if len(sys.argv) < 2:
        print("Usage: dere-hook-session-end.py <session_id> [exit_reason]", file=sys.stderr)
        sys.exit(1)

    session_id = int(sys.argv[1])
    exit_reason = sys.argv[2] if len(sys.argv) > 2 else "normal"

    rpc = RPCClient()
    result = rpc.end_session(session_id, exit_reason)

    if result:
        print("Session ended successfully")
    else:
        print("Failed to end session", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()