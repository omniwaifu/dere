#!/usr/bin/env python3
"""Wrapper to run taskwarrior MCP server with resolved path."""
import subprocess
import sys
from pathlib import Path

def main():
    # Find the MCP server relative to this script
    script_dir = Path(__file__).parent.parent
    mcp_server = script_dir / "mcp-server" / "dist" / "index.js"
    
    # Run the MCP server
    subprocess.run(["node", str(mcp_server)] + sys.argv[1:])

if __name__ == "__main__":
    main()
