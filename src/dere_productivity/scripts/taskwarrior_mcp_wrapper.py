#!/usr/bin/env python3
"""Wrapper to run taskwarrior MCP server with resolved path."""
import subprocess
import sys
from pathlib import Path


def main():
    package_root = Path(__file__).resolve().parent.parent
    mcp_server = package_root / "mcp-server" / "dist" / "index.js"

    if not mcp_server.exists():
        print(f"Error: MCP server not found at {mcp_server}", file=sys.stderr)
        print("Run 'just build-mcp' to build it", file=sys.stderr)
        sys.exit(1)

    # Run the MCP server
    subprocess.run(["node", str(mcp_server)] + sys.argv[1:])

if __name__ == "__main__":
    main()
