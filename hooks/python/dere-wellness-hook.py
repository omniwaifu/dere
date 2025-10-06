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
        with open("/tmp/dere_wellness_hook_debug.log", "a") as f:
            f.write(f"Error reading transcript: {e}\n")
        return []


def extract_conversation_text(transcript_entries):
    """Extract the full conversation text from transcript entries"""
    try:
        conversation_parts = []

        for entry in transcript_entries:
            if entry.get("type") == "user" and "message" in entry:
                message = entry["message"]
                if message.get("role") == "user" and "content" in message:
                    content = message["content"]
                    if isinstance(content, str):
                        conversation_parts.append(f"User: {content}")
                    elif isinstance(content, list):
                        text_parts = []
                        for item in content:
                            if isinstance(item, dict) and item.get("type") == "text":
                                text_parts.append(item.get("text", ""))
                        if text_parts:
                            conversation_parts.append(f"User: {' '.join(text_parts)}")

            elif entry.get("type") == "assistant" and "message" in entry:
                message = entry["message"]
                if message.get("role") == "assistant" and "content" in message:
                    content = message["content"]
                    if isinstance(content, str):
                        conversation_parts.append(f"Assistant: {content}")
                    elif isinstance(content, list):
                        text_parts = []
                        for item in content:
                            if isinstance(item, dict) and item.get("type") == "text":
                                text_parts.append(item.get("text", ""))
                        if text_parts:
                            conversation_parts.append(f"Assistant: {' '.join(text_parts)}")

        return "\n\n".join(conversation_parts) if conversation_parts else None

    except Exception as e:
        with open("/tmp/dere_wellness_hook_debug.log", "a") as f:
            f.write(f"Error extracting conversation: {e}\n")
        return None


def extract_wellness_data(conversation_text, mode, session_id):
    """Extract wellness data from conversation using RPC call"""
    try:
        rpc = RPCClient()
        result = rpc.call(
            "mode.wellness.extract",
            {"mode": mode, "conversation": conversation_text, "session_id": session_id},
        )
        return result
    except Exception as e:
        with open("/tmp/dere_wellness_hook_debug.log", "a") as f:
            f.write(f"Error extracting wellness data: {e}\n")
        return None


def main():
    # Debug: log all input
    with open("/tmp/dere_wellness_hook_debug.log", "a") as f:
        f.write(f"Wellness hook called with args: {sys.argv}\n")

    # Read from stdin (Claude Code passes hook data via stdin)
    try:
        stdin_data = sys.stdin.read().strip()
        with open("/tmp/dere_wellness_hook_debug.log", "a") as f:
            f.write(f"Wellness hook stdin data: {stdin_data}\n")

        if not stdin_data:
            with open("/tmp/dere_wellness_hook_debug.log", "a") as f:
                f.write("No stdin data received\n")
            sys.exit(0)

        hook_data = json.loads(stdin_data)

        # Only process if this is a mental health mode session
        mode = os.getenv("DERE_MODE")
        if not mode or mode not in ["checkin", "cbt", "therapy", "mindfulness", "goals"]:
            with open("/tmp/dere_wellness_hook_debug.log", "a") as f:
                f.write(f"Skipping - not a mental health mode (mode: {mode})\n")
            sys.exit(0)

        # Get session ID from environment (dere's numeric session ID)
        session_id = int(os.getenv("DERE_SESSION_ID", "0"))
        if session_id == 0:
            with open("/tmp/dere_wellness_hook_debug.log", "a") as f:
                f.write("No valid session ID found\n")
            sys.exit(0)

        # Extract transcript path
        transcript_path = hook_data.get("transcript_path")
        if not transcript_path:
            with open("/tmp/dere_wellness_hook_debug.log", "a") as f:
                f.write("No transcript path provided\n")
            sys.exit(0)

        # Read and parse transcript
        transcript_entries = read_transcript(transcript_path)
        if not transcript_entries:
            with open("/tmp/dere_wellness_hook_debug.log", "a") as f:
                f.write("No transcript entries found\n")
            sys.exit(0)

        # Extract full conversation
        conversation_text = extract_conversation_text(transcript_entries)
        if not conversation_text:
            with open("/tmp/dere_wellness_hook_debug.log", "a") as f:
                f.write("No conversation text found\n")
            sys.exit(0)

        with open("/tmp/dere_wellness_hook_debug.log", "a") as f:
            f.write(f"Extracted conversation (length: {len(conversation_text)})\n")

        # Extract wellness data using LLM
        wellness_data = extract_wellness_data(conversation_text, mode, session_id)
        if wellness_data:
            with open("/tmp/dere_wellness_hook_debug.log", "a") as f:
                f.write(f"Wellness data extracted: {wellness_data}\n")
        else:
            with open("/tmp/dere_wellness_hook_debug.log", "a") as f:
                f.write("Failed to extract wellness data\n")

    except Exception as e:
        with open("/tmp/dere_wellness_hook_debug.log", "a") as f:
            f.write(f"Error in wellness hook: {e}\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
