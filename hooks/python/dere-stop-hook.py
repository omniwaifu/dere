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


def read_transcript(transcript_path):
    """Read and parse the Claude Code transcript file (JSONL format)"""
    try:
        with open(transcript_path) as f:
            lines = f.readlines()

        # Parse each line as JSON
        transcript_entries = []
        for line in lines:
            line = line.strip()
            if line:
                try:
                    entry = json.loads(line)
                    transcript_entries.append(entry)
                except json.JSONDecodeError:
                    continue

        return transcript_entries
    except Exception as e:
        with open("/tmp/dere_stop_hook_debug.log", "a") as f:
            f.write(f"Error reading transcript: {e}\n")
        return []


def extract_claude_response(transcript_entries):
    """Extract Claude's latest response from transcript entries"""
    try:
        # Look for the latest assistant message
        for entry in reversed(transcript_entries):
            if entry.get("type") == "assistant" and "message" in entry:
                message = entry["message"]
                if message.get("role") == "assistant" and "content" in message:
                    content = message["content"]
                    if isinstance(content, list) and len(content) > 0:
                        # Extract text from content array
                        text_parts = []
                        for item in content:
                            if isinstance(item, dict) and item.get("type") == "text":
                                text_parts.append(item.get("text", ""))
                        return "\n".join(text_parts) if text_parts else None
                    elif isinstance(content, str):
                        return content
        return None
    except Exception as e:
        with open("/tmp/dere_stop_hook_debug.log", "a") as f:
            f.write(f"Error extracting Claude response: {e}\n")
        return None


def main():
    # Debug: log all input
    with open("/tmp/dere_stop_hook_debug.log", "a") as f:
        f.write(f"Stop hook called with args: {sys.argv}\n")

    # Read from stdin (Claude Code passes hook data via stdin)
    try:
        stdin_data = sys.stdin.read().strip()
        with open("/tmp/dere_stop_hook_debug.log", "a") as f:
            f.write(f"Stop hook stdin data: {stdin_data}\n")

        if not stdin_data:
            with open("/tmp/dere_stop_hook_debug.log", "a") as f:
                f.write("No stdin data received\n")
            sys.exit(0)

        hook_data = json.loads(stdin_data)

        # Only process if DERE_PERSONALITY is set (i.e., this is a dere session)
        personality = os.getenv("DERE_PERSONALITY")
        if not personality:
            with open("/tmp/dere_stop_hook_debug.log", "a") as f:
                f.write("Skipping - not a dere session (no DERE_PERSONALITY)\n")
            sys.exit(0)

        # Get session ID from environment
        session_id = int(os.getenv("DERE_SESSION_ID", "0"))
        project_path = os.getenv("PWD", "")

        # Extract transcript path
        transcript_path = hook_data.get("transcript_path")
        if not transcript_path:
            with open("/tmp/dere_stop_hook_debug.log", "a") as f:
                f.write("No transcript path provided\n")
            sys.exit(0)

        # Read and parse transcript
        transcript_entries = read_transcript(transcript_path)
        if not transcript_entries:
            with open("/tmp/dere_stop_hook_debug.log", "a") as f:
                f.write("No transcript entries found\n")
            sys.exit(0)

        # Extract Claude's response
        claude_response = extract_claude_response(transcript_entries)
        if not claude_response:
            with open("/tmp/dere_stop_hook_debug.log", "a") as f:
                f.write("No Claude response found in transcript\n")
            sys.exit(0)

        with open("/tmp/dere_stop_hook_debug.log", "a") as f:
            f.write(f"Captured Claude response (length: {len(claude_response)})\n")

        # Store Claude's response
        rpc = RPCClient()
        result = rpc.capture_claude_response(session_id, personality, project_path, claude_response)

        with open("/tmp/dere_stop_hook_debug.log", "a") as f:
            f.write(f"RPC result for Claude response: {result}\n")

        if result:
            with open("/tmp/dere_stop_hook_debug.log", "a") as f:
                f.write("Claude response captured successfully\n")
        else:
            with open("/tmp/dere_stop_hook_debug.log", "a") as f:
                f.write("Failed to capture Claude response\n")

        # Suppress output to avoid cluttering message history
        print(json.dumps({"suppressOutput": True}))

    except Exception as e:
        with open("/tmp/dere_stop_hook_debug.log", "a") as f:
            f.write(f"Error in stop hook: {e}\n")
        # Suppress output even on error
        print(json.dumps({"suppressOutput": True}))
        sys.exit(1)


if __name__ == "__main__":
    main()
