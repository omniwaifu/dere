from __future__ import annotations

import json
import os
import platform
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import click

from dere_cli.mcp import build_mcp_config
from dere_shared.personalities import PersonalityLoader


def get_config_dir() -> Path:
    """Get platform-specific config directory"""
    match platform.system():
        case "Windows":
            return Path(os.getenv("LOCALAPPDATA", "")) / "dere"
        case "Darwin":
            return Path.home() / "Library" / "Application Support" / "dere"
        case _:
            return Path.home() / ".config" / "dere"


def get_data_dir() -> Path:
    """Get platform-specific data directory"""
    match platform.system():
        case "Windows":
            return Path(os.getenv("LOCALAPPDATA", "")) / "dere"
        case "Darwin":
            return Path.home() / "Library" / "Application Support" / "dere"
        case _:
            return Path.home() / ".local" / "share" / "dere"


def generate_session_id() -> int:
    """Generate unique session ID"""
    return int(time.time_ns() % (1 << 31))


class SettingsBuilder:
    """Build Claude settings JSON for interactive mode"""

    def __init__(
        self,
        personality: str | None = None,
        output_style: str | None = None,
        context: bool = False,
        session_id: int | None = None,
    ):
        self.personality = personality
        self.output_style = output_style
        self.context = context
        self.session_id = session_id
        self.config_dir = get_config_dir()
        self.hooks_dir = self.config_dir / "hooks"
        self.temp_files: list[str] = []

    def build(self) -> dict:
        """Build settings dictionary"""
        settings = {
            "hooks": {},
            "statusLine": {},
            "env": {},
        }

        if self.output_style:
            settings["outputStyle"] = self.output_style

        # Add hooks if they exist
        self._add_conversation_hooks(settings)
        self._add_status_line(settings)
        self._add_hook_environment(settings)

        return settings

    def _add_conversation_hooks(self, settings: dict) -> None:
        """Add conversation capture hooks"""
        hooks = []

        # Context hook (if enabled)
        if self.context:
            context_hook = self.hooks_dir / "dere-context-hook.py"
            if context_hook.exists():
                hooks.append(
                    {
                        "matcher": "",
                        "hooks": [
                            {
                                "type": "command",
                                "command": str(context_hook),
                            }
                        ],
                    }
                )

        # Capture hook
        capture_hook = self.hooks_dir / "dere-hook.py"
        if capture_hook.exists():
            hooks.append(
                {
                    "matcher": "",
                    "hooks": [
                        {
                            "type": "command",
                            "command": str(capture_hook),
                        }
                    ],
                }
            )

        # Stop hook
        stop_hook = self.hooks_dir / "dere-stop-hook.py"
        if stop_hook.exists():
            hooks.append(
                {
                    "matcher": "",
                    "hooks": [
                        {
                            "type": "command",
                            "command": str(stop_hook),
                        }
                    ],
                }
            )

        # Wellness hook
        wellness_hook = self.hooks_dir / "dere-wellness-hook.py"
        if wellness_hook.exists():
            hooks.append(
                {
                    "matcher": "",
                    "hooks": [
                        {
                            "type": "command",
                            "command": str(wellness_hook),
                        }
                    ],
                }
            )

        if hooks:
            settings["hooks"]["UserPromptSubmit"] = hooks

        # Session end hook (separate event)
        session_end_hook = self.hooks_dir / "dere-hook-session-end.py"
        if session_end_hook.exists():
            settings["hooks"]["SessionEnd"] = [
                {
                    "matcher": "",
                    "hooks": [
                        {
                            "type": "command",
                            "command": str(session_end_hook),
                        }
                    ],
                }
            ]

    def _add_status_line(self, settings: dict) -> None:
        """Add status line hook"""
        statusline_hook = self.hooks_dir / "dere-statusline.py"

        if statusline_hook.exists():
            settings["statusLine"] = {
                "type": "command",
                "command": str(statusline_hook),
                "padding": 0,
            }

    def _add_hook_environment(self, settings: dict) -> None:
        """Add environment variables for hooks"""
        if self.personality:
            settings["env"]["DERE_PERSONALITY"] = self.personality

        # Add daemon URL for hooks to call
        settings["env"]["DERE_DAEMON_URL"] = "http://localhost:8787"

        # Add context flag
        if self.context:
            settings["env"]["DERE_CONTEXT"] = "true"

        # Add session ID
        if self.session_id:
            settings["env"]["DERE_SESSION_ID"] = str(self.session_id)

    def cleanup(self):
        """Clean up temporary files"""
        for temp_file in self.temp_files:
            try:
                os.unlink(temp_file)
            except Exception:
                pass


def compose_system_prompt(personalities: list[str]) -> str:
    """Compose system prompt from personalities"""
    if not personalities:
        return ""

    config_dir = get_config_dir()
    loader = PersonalityLoader(config_dir)

    prompts = []
    for personality in personalities:
        try:
            pers = loader.load(personality)
            prompts.append(pers.prompt_content)
        except ValueError as e:
            print(f"Warning: {e}", file=sys.stderr)

    return "\n\n".join(prompts)


@click.group(invoke_without_command=True)
@click.option("-P", "--personality", "personalities", multiple=True, help="Personality modes")
@click.option("--output-style", help="Output style override")
@click.option("-p", "--print", "print_mode", is_flag=True, help="Print mode")
@click.option("-c", "--continue", "continue_conv", is_flag=True, help="Continue last conversation")
@click.option("-r", "--resume", help="Resume specific session ID")
@click.option("--bare", is_flag=True, help="Plain Claude, no personality")
@click.option("--context", is_flag=True, help="Enable contextual information")
@click.option("--context-depth", default=5, help="Number of related conversations")
@click.option("--context-mode", default="smart", help="Context mode: summary, full, smart")
@click.option("--max-context-tokens", default=2000, help="Max tokens for context")
@click.option("--include-history", is_flag=True, help="Include conversation history")
@click.option("--mode", help="Mental health mode (checkin, cbt, therapy, mindfulness, goals)")
@click.option("--model", help="Model override")
@click.option("--fallback-model", help="Fallback model")
@click.option("--permission-mode", help="Permission mode")
@click.option("--allowed-tools", help="Comma-separated allowed tools")
@click.option("--disallowed-tools", help="Comma-separated disallowed tools")
@click.option("--add-dir", "add_dirs", multiple=True, help="Additional directories")
@click.option("--ide", is_flag=True, help="Auto-connect to IDE")
@click.option("--mcp", "mcp_servers", multiple=True, help="MCP servers to use")
@click.option("--dry-run", is_flag=True, help="Print command without executing")
@click.argument("args", nargs=-1)
@click.pass_context
def cli(
    ctx,
    personalities,
    output_style,
    print_mode,
    continue_conv,
    resume,
    bare,
    context,
    context_depth,
    context_mode,
    max_context_tokens,
    include_history,
    mode,
    model,
    fallback_model,
    permission_mode,
    allowed_tools,
    disallowed_tools,
    add_dirs,
    ide,
    mcp_servers,
    dry_run,
    args,
):
    """Dere - Personality-layered wrapper for Claude Code"""

    # If subcommand is being invoked, don't run claude
    if ctx.invoked_subcommand is not None:
        return

    # Generate session ID
    session_id = generate_session_id()
    os.environ["DERE_SESSION_ID"] = str(session_id)

    # Set environment variables
    if mcp_servers:
        os.environ["DERE_MCP_SERVERS"] = ",".join(mcp_servers)
    if context:
        os.environ["DERE_CONTEXT"] = "true"
    if output_style:
        os.environ["DERE_OUTPUT_STYLE"] = output_style
    if mode:
        os.environ["DERE_MODE"] = mode
    if include_history:
        os.environ["DERE_INCLUDE_HISTORY"] = "true"
        os.environ["DERE_CONTEXT_DEPTH"] = str(context_depth)
        os.environ["DERE_CONTEXT_MODE"] = context_mode
        os.environ["DERE_MAX_CONTEXT_TOKENS"] = str(max_context_tokens)

    # Determine session type
    if continue_conv:
        os.environ["DERE_SESSION_TYPE"] = "continue"
    elif resume:
        os.environ["DERE_SESSION_TYPE"] = "resume"
    else:
        os.environ["DERE_SESSION_TYPE"] = "new"

    # Default to tsun if no personality specified and not bare
    personalities_list = list(personalities)
    if not bare and not personalities_list:
        personalities_list = ["tsun"]

    # Build settings
    personality_str = ",".join(personalities_list) if personalities_list else None
    effective_output_style = output_style or (mode if mode else None)
    builder = SettingsBuilder(
        personality=personality_str,
        output_style=effective_output_style,
        context=context,
        session_id=session_id,
    )
    settings = builder.build()

    # Write settings to temp file
    settings_path = None
    if settings:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            json.dump(settings, f, indent=2)
            settings_path = f.name
            builder.temp_files.append(settings_path)

    try:
        # Compose system prompt
        system_prompt = ""
        if not bare and personalities_list:
            system_prompt = compose_system_prompt(personalities_list)

        # Build claude command
        cmd = ["claude"]

        # Add continue/resume flags
        if continue_conv:
            cmd.append("-c")
        elif resume:
            cmd.extend(["-r", resume])

        # Add model configuration
        if model:
            cmd.extend(["--model", model])
        if fallback_model:
            cmd.extend(["--fallback-model", fallback_model])

        # Add permission mode
        if permission_mode:
            cmd.extend(["--permission-mode", permission_mode])

        # Add tool restrictions
        if allowed_tools:
            cmd.extend(["--allowed-tools", allowed_tools])
        if disallowed_tools:
            cmd.extend(["--disallowed-tools", disallowed_tools])

        # Add additional directories
        for dir_path in add_dirs:
            cmd.extend(["--add-dir", dir_path])

        # Add IDE flag
        if ide:
            cmd.append("--ide")

        # Add settings file
        if settings_path:
            cmd.extend(["--settings", settings_path])

        # Add system prompt
        if system_prompt:
            cmd.extend(["--append-system-prompt", system_prompt])

        # Add print mode
        if print_mode:
            cmd.append("-p")

        # Add MCP servers
        mcp_config_path = None
        if mcp_servers:
            try:
                config_dir = get_config_dir()
                mcp_config_path = build_mcp_config(list(mcp_servers), config_dir)
                if mcp_config_path:
                    cmd.extend(["--mcp-config", mcp_config_path])
                    builder.temp_files.append(mcp_config_path)
            except ValueError as e:
                print(f"Error: {e}", file=sys.stderr)
                sys.exit(1)

        # Add separator if we have args
        if args or mode:
            cmd.append("--")

        # Add wellness initiation for modes
        if mode and not args:
            cmd.append("/dere-wellness")
        else:
            cmd.extend(args)

        # Dry run mode - print command and exit
        if dry_run:
            print("Command:", " ".join(cmd))
            print("\nEnvironment variables:")
            for key in sorted(os.environ.keys()):
                if key.startswith("DERE_"):
                    print(f"  {key}={os.environ[key]}")
            if settings_path:
                print(f"\nSettings file: {settings_path}")
                with open(settings_path) as f:
                    print(f.read())
            if mcp_config_path:
                print(f"\nMCP config file: {mcp_config_path}")
                with open(mcp_config_path) as f:
                    print(f.read())
            if system_prompt:
                print(f"\nSystem prompt ({len(system_prompt)} chars):")
                print(system_prompt[:500] + "..." if len(system_prompt) > 500 else system_prompt)
            return

        # Run claude
        try:
            process = subprocess.Popen(cmd, stdin=sys.stdin, stdout=sys.stdout, stderr=sys.stderr)

            # Setup signal handling
            def signal_handler(signum, frame):
                process.send_signal(signum)

            signal.signal(signal.SIGINT, signal_handler)
            signal.signal(signal.SIGTERM, signal_handler)

            # Wait for process
            process.wait()
            sys.exit(process.returncode)

        except FileNotFoundError:
            print("Error: 'claude' command not found. Please install Claude CLI.", file=sys.stderr)
            sys.exit(1)

    finally:
        builder.cleanup()


@cli.command()
def daemon():
    """Daemon management"""
    click.echo("Daemon commands coming soon...")


@cli.command()
def queue():
    """Queue management"""
    click.echo("Queue commands coming soon...")


@cli.command()
def history():
    """View conversation history"""
    click.echo("History commands coming soon...")


@cli.command()
def entities():
    """View extracted entities"""
    click.echo("Entities commands coming soon...")


@cli.command()
def summaries():
    """View session summaries"""
    click.echo("Summaries commands coming soon...")


@cli.command()
def wellness():
    """Wellness tracking"""
    click.echo("Wellness commands coming soon...")


@cli.command()
def stats():
    """View statistics"""
    click.echo("Stats commands coming soon...")


@cli.command()
def config():
    """Configuration management"""
    click.echo("Config commands coming soon...")


@cli.command()
def version():
    """Show version"""
    click.echo("dere 0.1.0 (Python rewrite)")


if __name__ == "__main__":
    cli()
