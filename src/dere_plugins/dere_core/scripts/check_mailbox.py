#!/usr/bin/env python
"""PostToolUse hook script to check agent mailbox.

This script is called after every tool use by swarm agents.
It checks the scratchpad for messages addressed to this agent
and outputs them so the agent can see them.
"""

from __future__ import annotations

import asyncio
import os

import httpx

DAEMON_URL = os.environ.get("DERE_DAEMON_URL", "http://localhost:8787")
SWARM_ID = os.environ.get("DERE_SWARM_ID")
AGENT_NAME = os.environ.get("DERE_SWARM_AGENT_NAME")


async def check_mailbox() -> None:
    """Check for messages and output them."""
    if not SWARM_ID or not AGENT_NAME:
        return  # Not in swarm context, silently exit

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            # List messages for this agent
            resp = await client.get(
                f"{DAEMON_URL}/swarm/{SWARM_ID}/scratchpad",
                params={"prefix": f"messages/to-{AGENT_NAME}/"},
            )
            if resp.status_code != 200:
                return

            messages = resp.json()
            if not messages:
                return

            # Output messages to stdout (will be shown to agent)
            print("\nYou have messages from other agents:\n")

            for entry in messages:
                key = entry.get("key", "")
                value = entry.get("value", {})

                sender = value.get("from", "unknown")
                text = value.get("text", "")
                priority = value.get("priority", "normal")

                # Format output
                priority_marker = "[URGENT] " if priority == "urgent" else ""
                print(f"{priority_marker}From '{sender}':")
                print(f"  {text}\n")

                # Delete after reading to prevent duplicate delivery
                try:
                    await client.delete(
                        f"{DAEMON_URL}/swarm/{SWARM_ID}/scratchpad/{key}",
                    )
                except Exception:
                    pass  # Best effort deletion

    except Exception:
        # Silently fail - don't interrupt agent execution
        pass


def main() -> None:
    """Entry point."""
    asyncio.run(check_mailbox())


if __name__ == "__main__":
    main()
