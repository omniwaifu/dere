#!/usr/bin/env python3
import sys
import os

# Add the hooks directory to Python path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from rpc_client import RPCClient

def main():
    if len(sys.argv) < 5:
        print("Usage: dere-hook.py <session_id> <personality> <project_path> <prompt>", file=sys.stderr)
        sys.exit(1)

    session_id = int(sys.argv[1])
    personality = sys.argv[2]
    project_path = sys.argv[3]
    prompt = sys.argv[4]

    rpc = RPCClient()
    result = rpc.capture_conversation(session_id, personality, project_path, prompt)

    if result:
        print("Conversation captured successfully")
    else:
        print("Failed to capture conversation", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()