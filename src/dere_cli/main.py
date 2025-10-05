from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import click
import httpx

from dere_shared.personalities import PersonalityLoader


def get_config_dir() -> Path:
    """Get platform-specific config directory"""
    if os.name == "nt":
        return Path(os.getenv("LOCALAPPDATA", "")) / "dere"
    elif os.uname().sysname == "Darwin":
        return Path.home() / "Library" / "Application Support" / "dere"
    else:
        return Path.home() / ".config" / "dere"


def get_data_dir() -> Path:
    """Get platform-specific data directory"""
    if os.name == "nt":
        return Path(os.getenv("LOCALAPPDATA", "")) / "dere"
    elif os.uname().sysname == "Darwin":
        return Path.home() / "Library" / "Application Support" / "dere"
    else:
        return Path.home() / ".local" / "share" / "dere"


class SettingsBuilder:
    """Build Claude settings JSON for interactive mode"""

    def __init__(self, personality: str | None = None, output_style: str | None = None):
        self.personality = personality
        self.output_style = output_style
        self.config_dir = get_config_dir()
        self.hooks_dir = self.config_dir / "hooks"

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
        capture_hook = self.hooks_dir / "capture.sh"

        if capture_hook.exists():
            settings["hooks"]["UserPromptSubmit"] = [
                {
                    "matcher": "",
                    "hooks": [
                        {
                            "type": "command",
                            "command": str(capture_hook),
                        }
                    ],
                }
            ]

    def _add_status_line(self, settings: dict) -> None:
        """Add status line hook"""
        statusline_hook = self.hooks_dir / "statusline.sh"

        if statusline_hook.exists():
            settings["statusLine"] = {
                "enabled": True,
                "command": str(statusline_hook),
            }

    def _add_hook_environment(self, settings: dict) -> None:
        """Add environment variables for hooks"""
        if self.personality:
            settings["env"]["DERE_PERSONALITY"] = self.personality

        # Add daemon URL for hooks to call
        settings["env"]["DERE_DAEMON_URL"] = "http://localhost:8000"


async def create_session_in_daemon(personality: str, working_dir: str) -> int:
    """Create a session in the daemon and return session ID"""
    async with httpx.AsyncClient() as client:
        try:
            response = await client.post(
                "http://localhost:8000/sessions/create",
                json={"working_dir": working_dir, "personality": personality, "medium": "cli"},
                timeout=5.0,
            )
            response.raise_for_status()
            return response.json()["session_id"]
        except Exception as e:
            print(f"Warning: Could not create session in daemon: {e}", file=sys.stderr)
            return -1


@click.group(invoke_without_command=True)
@click.option("-P", "--personality", help="Personality to use (tsun, kuu, yan, dere, ero)")
@click.option("--output-style", help="Output style override")
@click.option("-p", "--print", "print_mode", is_flag=True, help="Non-interactive print mode")
@click.option("-c", "--continue", "continue_conv", is_flag=True, help="Continue last conversation")
@click.option("--bare", is_flag=True, help="Plain Claude, no personality")
@click.pass_context
def cli(ctx, personality, output_style, print_mode, continue_conv, bare):
    """Dere - Personality-layered wrapper for Claude Code"""

    # If subcommand is being invoked, don't run claude
    if ctx.invoked_subcommand is not None:
        return

    # Default to tsun if no personality specified and not bare
    if not bare and not personality:
        personality = "tsun"

    # Build system prompt from personality
    system_prompt = ""
    if personality and not bare:
        config_dir = get_config_dir()
        loader = PersonalityLoader(config_dir)

        try:
            pers = loader.load(personality)
            system_prompt = pers.prompt_content
        except ValueError as e:
            print(f"Error loading personality: {e}", file=sys.stderr)
            sys.exit(1)

    # Build settings
    builder = SettingsBuilder(personality=personality, output_style=output_style)
    settings = builder.build()

    # Write settings to temp file
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        json.dump(settings, f, indent=2)
        settings_path = f.name

    # Build claude command
    cmd = ["claude"]

    if settings_path:
        cmd.extend(["--settings", settings_path])

    if system_prompt:
        cmd.extend(["--system-prompt", system_prompt])

    if continue_conv:
        cmd.append("--continue")

    if print_mode:
        # Pass through remaining args for print mode
        cmd.extend(sys.argv[sys.argv.index("-p") + 1 :])

    # Spawn claude
    try:
        subprocess.run(cmd)
    finally:
        # Cleanup temp settings file
        try:
            os.unlink(settings_path)
        except Exception:
            pass


@cli.command()
def daemon():
    """Daemon management"""
    click.echo("Daemon commands coming soon...")


@cli.command()
def queue():
    """Queue management"""
    click.echo("Queue commands coming soon...")


if __name__ == "__main__":
    cli()
