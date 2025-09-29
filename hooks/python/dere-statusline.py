#!/usr/bin/env python3
import sys
import os
import json
import subprocess

# ANSI color codes
RESET = "\033[0m"
RED = "\033[31m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
BLUE = "\033[34m"
MAGENTA = "\033[35m"
CYAN = "\033[36m"
GRAY = "\033[90m"
WHITE = "\033[37m"

def format_personality(personality):
    """Format personality with colored indicator"""
    # Get color and icon from environment if available
    color_name = os.getenv("DERE_PERSONALITY_COLOR", "").lower()
    icon = os.getenv("DERE_PERSONALITY_ICON", "●")

    # Map color names to ANSI codes
    color_map = {
        "red": RED,
        "blue": BLUE,
        "magenta": MAGENTA,
        "green": GREEN,
        "yellow": YELLOW,
        "cyan": CYAN,
        "gray": GRAY,
        "white": WHITE
    }

    # Get the color code, default to GRAY
    color_code = color_map.get(color_name, GRAY)

    # Format with color and icon
    if "+" in personality:
        # Multiple personalities combined
        return color_code + icon + RESET + " " + personality
    else:
        return color_code + icon + RESET + " " + personality

def format_model(model):
    """Format model name with indicator"""
    model_lower = model.lower()

    if "opus" in model_lower:
        return YELLOW + "◆" + RESET + " opus"
    elif "sonnet" in model_lower:
        return WHITE + "◇" + RESET + " sonnet"
    elif "haiku" in model_lower:
        return GRAY + "◦" + RESET + " haiku"
    else:
        parts = model.split("-")
        if parts:
            return GRAY + "◈" + RESET + " " + parts[0]
        return GRAY + "◈" + RESET + " model"

def format_mcp_servers(servers):
    """Format MCP servers"""
    if not servers:
        return ""

    server_list = [s.strip() for s in servers.split(",")]
    count = len(server_list)

    if count == 1:
        return CYAN + "▪" + RESET + " " + server_list[0]
    else:
        return CYAN + "▪" + RESET + f" {count}"

def format_session_type(session_type):
    """Format session type"""
    if session_type == "continue":
        return GREEN + "↻" + RESET + " cont"
    elif session_type == "resume":
        return YELLOW + "↵" + RESET + " resume"
    else:
        return GRAY + "●" + RESET + " " + session_type

def check_daemon_status():
    """Check if dere daemon is running by checking PID file"""
    try:
        home = os.path.expanduser("~")
        pid_file = os.path.join(home, ".local", "share", "dere", "daemon.pid")

        if not os.path.exists(pid_file):
            return False

        with open(pid_file, 'r') as f:
            pid = int(f.read().strip())

        # Check if process exists
        try:
            os.kill(pid, 0)
            return True
        except OSError:
            return False
    except (FileNotFoundError, ValueError, PermissionError):
        return False

def format_daemon_status(is_running):
    """Format daemon status indicator"""
    if is_running:
        return GREEN + "●" + RESET + " daemon"
    else:
        return RED + "●" + RESET + " daemon"

def shorten_path(path):
    """Shorten long paths"""
    home = os.path.expanduser("~")
    if path.startswith(home):
        path = "~" + path[len(home):]

    if len(path) > 25:
        parts = path.split("/")
        if len(parts) > 3:
            return parts[0] + "/.../" + parts[-1]

    return path

def show_dere_status_only():
    """Show minimal dere status when no session data"""
    parts = []

    # Check daemon status
    daemon_running = check_daemon_status()
    parts.append(format_daemon_status(daemon_running))

    # Personality
    personality = os.getenv("DERE_PERSONALITY", "")
    if personality and personality != "bare":
        parts.append(format_personality(personality))
    else:
        parts.append(GRAY + "dere" + RESET)

    print((GRAY + " │ " + RESET).join(parts), end="")

def main():
    """Main statusline function"""
    # Try to read Claude session data from stdin
    try:
        session = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        show_dere_status_only()
        return

    # Get dere configuration from environment
    personality = os.getenv("DERE_PERSONALITY", "")
    mcp_servers = os.getenv("DERE_MCP_SERVERS", "")
    context = os.getenv("DERE_CONTEXT", "")
    output_style = os.getenv("DERE_OUTPUT_STYLE", "")
    custom_prompts = os.getenv("DERE_CUSTOM_PROMPTS", "")
    session_type = os.getenv("DERE_SESSION_TYPE", "")

    parts = []

    # Daemon status
    daemon_running = check_daemon_status()
    parts.append(format_daemon_status(daemon_running))

    # Personality with color
    if personality and personality != "bare":
        parts.append(format_personality(personality))

    # Model info
    if "model" in session and "id" in session["model"]:
        parts.append(format_model(session["model"]["id"]))

    # MCP servers
    if mcp_servers:
        parts.append(format_mcp_servers(mcp_servers))

    # Context awareness
    if context == "true":
        parts.append(GRAY + "⊙" + RESET + " ctx")

    # Session type
    if session_type and session_type != "new":
        parts.append(format_session_type(session_type))

    # Custom prompts
    if custom_prompts:
        parts.append(GRAY + "□" + RESET + " " + custom_prompts)

    # Output style
    if output_style and output_style != "default":
        parts.append(GRAY + "◈" + RESET + " " + output_style)

    # Working directory
    if "cwd" in session and session["cwd"]:
        parts.append(GRAY + "▸" + RESET + " " + shorten_path(session["cwd"]))

    # Join with separators
    if parts:
        print((GRAY + " │ " + RESET).join(parts), end="")

if __name__ == "__main__":
    main()