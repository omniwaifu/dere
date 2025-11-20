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
from dere_shared.config import load_dere_config
from dere_shared.constants import DEFAULT_DAEMON_URL
from dere_shared.paths import get_config_dir, get_data_dir
from dere_shared.personalities import PersonalityLoader


def get_dere_plugin_dir() -> Path:
    """Get dere plugin directory for skills loading"""
    import dere_core

    # dere_core module is in src/dere_plugins/dere_core/
    plugin_path = Path(dere_core.__file__).parent
    return plugin_path


def generate_session_id() -> int:
    """Generate unique session ID"""
    return int(time.time_ns() % (1 << 31))


def get_session_tracking_file() -> Path:
    """Get session tracking JSON file."""
    data_dir = get_data_dir()
    return data_dir / "sessions.json"


def load_session_map() -> dict:
    """Load session tracking map."""
    file = get_session_tracking_file()
    if not file.exists():
        return {}
    with open(file) as f:
        return json.load(f)


def save_session_map(sessions: dict):
    """Save session tracking map."""
    file = get_session_tracking_file()
    file.parent.mkdir(parents=True, exist_ok=True)
    with open(file, "w") as f:
        json.dump(sessions, f, indent=2)


def get_last_session_for_dir(cwd: str) -> str | None:
    """Get last session ID for directory."""
    sessions = load_session_map()
    return sessions.get(cwd, {}).get("last_session_id")


def save_session_for_dir(cwd: str, session_id: str):
    """Save session ID for directory."""
    sessions = load_session_map()
    sessions[cwd] = {"last_session_id": session_id, "timestamp": int(time.time())}
    save_session_map(sessions)


class SettingsBuilder:
    """Build Claude settings JSON for interactive mode"""

    def __init__(
        self,
        personality: str | None = None,
        output_style: str | None = None,
        mode: str | None = None,
        session_id: int | None = None,
        company_announcements: list[str] | None = None,
    ):
        self.personality = personality
        self.output_style = output_style
        self.mode = mode
        self.session_id = session_id
        self.company_announcements = company_announcements
        self.config_dir = get_config_dir()
        self.temp_files: list[str] = []
        self.enabled_plugins: list[str] = []

    def build(self) -> dict:
        """Build settings dictionary"""
        settings = {
            "hooks": {},
            "statusLine": {},
            "env": {},
        }

        # Auto-detect vault output style if not explicitly set
        output_style_to_use = self.output_style
        if not output_style_to_use:
            try:
                from dere_plugins.dere_vault.scripts.detect_vault import is_vault
                if is_vault():
                    output_style_to_use = "dere-vault:vault"
            except Exception:
                # Silent fail if vault plugin not installed or detection fails
                pass

        if output_style_to_use:
            settings["outputStyle"] = output_style_to_use

        if self.company_announcements:
            settings["companyAnnouncements"] = self.company_announcements

        # Add dere plugins marketplace and enable plugins
        self._add_dere_plugins(settings)

        # Control third-party plugins
        self._control_third_party_plugins(settings)

        # Add hooks and status line
        self._add_status_line(settings)
        self._add_hook_environment(settings)

        return settings

    def _should_enable_vault_plugin(self) -> bool:
        """Check if vault plugin should be enabled (via --mode vault or when in Obsidian vault)."""
        # CLI flag takes precedence
        if self.mode == "vault":
            return True
        
        # Fall back to auto-detection (in an Obsidian vault)
        try:
            from dere_plugins.dere_vault.scripts.detect_vault import is_vault

            return is_vault()
        except Exception:
            return False

    def _should_enable_productivity_plugin(self) -> bool:
        """Check if productivity plugin should be enabled (via --mode productivity or config)."""
        # CLI flag takes precedence
        if self.mode == "productivity":
            return True

        # Backwards compatibility: also accept "tasks" mode
        if self.mode == "tasks":
            return True

        # Fall back to config
        try:
            config = load_dere_config()
            productivity_config = config.get("plugins", {}).get("dere_productivity", {})
            mode = productivity_config.get("mode", "never")
            return mode == "always"
        except Exception:
            return False

    def _should_enable_graph_features_plugin(self) -> bool:
        """Check if graph features plugin should be enabled (when daemon is running)."""
        try:
            import httpx

            with httpx.Client() as client:
                response = client.get(f"{DEFAULT_DAEMON_URL}/health", timeout=0.5)
                return response.status_code == 200
        except Exception:
            return False

    def _should_enable_code_plugin(self) -> bool:
        """Check if code plugin should be enabled (via --mode code or config)."""
        # CLI flag takes precedence
        if self.mode == "code":
            return True
        
        # Fall back to config
        try:
            config = load_dere_config()
            code_config = config.get("plugins", {}).get("dere_code", {})
            mode = code_config.get("mode", "auto")
            directories = code_config.get("directories", [])

            if mode == "always":
                return True
            elif mode == "auto":
                cwd = Path.cwd()
                for directory in directories:
                    dir_path = Path(directory).expanduser().resolve()
                    try:
                        cwd.relative_to(dir_path)
                        return True
                    except ValueError:
                        continue
                return False
            else:  # mode == "never"
                return False
        except Exception:
            return False

    def _find_plugins_path(self) -> Path | None:
        """Find the dere_plugins directory path."""
        try:
            import dere_core

            plugin_file = Path(dere_core.__file__).resolve()

            # Check if we're in an editable install (site-packages)
            if "site-packages" in str(plugin_file):
                # Find the source directory by looking for src/dere_plugins
                cwd = Path.cwd()
                for parent in [cwd, *cwd.parents]:
                    candidate = parent / "src" / "dere_plugins"
                    if candidate.exists() and (candidate / ".claude-plugin").exists():
                        return candidate
                # Fallback to installed location
                return plugin_file.parent.parent
            else:
                # Running from source directly
                return plugin_file.parent.parent
        except Exception:
            return None

    def _add_dere_plugins(self, settings: dict) -> None:
        """Add dere plugins marketplace and enable plugins conditionally."""
        plugins_path = self._find_plugins_path()
        if not plugins_path:
            return  # Plugins not available

        # Add marketplace
        if "extraKnownMarketplaces" not in settings:
            settings["extraKnownMarketplaces"] = {}

        settings["extraKnownMarketplaces"]["dere_plugins"] = {
            "source": {"source": "directory", "path": str(plugins_path)}
        }

        # Initialize enabled plugins
        if "enabledPlugins" not in settings:
            settings["enabledPlugins"] = {}

        # Enable base dere-core plugin (always-on personality and environmental context)
        settings["enabledPlugins"]["dere-core@dere_plugins"] = True

        # Conditionally enable other plugins
        plugin_checks = [
            ("dere-vault@dere_plugins", "vault", self._should_enable_vault_plugin),
            ("dere-productivity@dere_plugins", "productivity", self._should_enable_productivity_plugin),
            ("dere-graph-features@dere_plugins", None, self._should_enable_graph_features_plugin),
            ("dere-code@dere_plugins", "code", self._should_enable_code_plugin),
        ]

        for plugin_name, mode_name, check_fn in plugin_checks:
            try:
                if check_fn():
                    settings["enabledPlugins"][plugin_name] = True
                    # Track enabled plugin for statusline (skip infrastructure plugins)
                    if mode_name:
                        self.enabled_plugins.append(mode_name)
            except Exception:
                # Plugin not available or detection failed
                pass

    def _control_third_party_plugins(self, settings: dict) -> None:
        """Control third-party plugins based on config (reserved for future external plugins)."""
        pass

    def _add_status_line(self, settings: dict) -> None:
        """Add status line from dere_core plugin"""
        from pathlib import Path

        plugin_statusline = Path(__file__).parent.parent / "dere_plugins" / "dere_core" / "scripts" / "dere-statusline.py"

        if plugin_statusline.exists():
            settings["statusLine"] = {
                "type": "command",
                "command": str(plugin_statusline),
                "padding": 0,
            }

    def _add_hook_environment(self, settings: dict) -> None:
        """Add environment variables for hooks"""
        if self.personality:
            settings["env"]["DERE_PERSONALITY"] = self.personality

        # Add daemon URL for hooks to call
        settings["env"]["DERE_DAEMON_URL"] = DEFAULT_DAEMON_URL

        # Set productivity mode env var for productivity context hook
        if self.mode == "productivity" or self.mode == "tasks":
            settings["env"]["DERE_PRODUCTIVITY"] = "true"

        # Export enabled plugins for statusline
        if self.enabled_plugins:
            settings["env"]["DERE_ENABLED_PLUGINS"] = "/".join(self.enabled_plugins)

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


def _setup_environment(
    session_id: int,
    mcp_servers: tuple,
    output_style: str | None,
    mode: str | None,
    continue_conv: bool,
    resume: str | None,
) -> None:
    """Set up environment variables for the session"""
    os.environ["DERE_SESSION_ID"] = str(session_id)

    if mcp_servers:
        os.environ["DERE_MCP_SERVERS"] = ",".join(mcp_servers)
    if output_style:
        os.environ["DERE_OUTPUT_STYLE"] = output_style
    if mode:
        os.environ["DERE_MODE"] = mode

    # Determine session type
    if continue_conv:
        os.environ["DERE_SESSION_TYPE"] = "continue"
    elif resume:
        os.environ["DERE_SESSION_TYPE"] = "resume"
    else:
        os.environ["DERE_SESSION_TYPE"] = "new"


def _load_personality_and_announcements(
    personalities_list: list[str],
) -> tuple[str | None, str | None]:
    """Load personality metadata and get announcement

    Returns:
        Tuple of (personality_str, announcement)
    """
    if not personalities_list:
        return None, None

    config_dir = get_config_dir()
    loader = PersonalityLoader(config_dir)
    config = load_dere_config()

    # Export personality metadata for statusline
    try:
        first_pers = loader.load(personalities_list[0])
        os.environ["DERE_PERSONALITY_COLOR"] = first_pers.color
        os.environ["DERE_PERSONALITY_ICON"] = first_pers.icon
    except ValueError:
        pass

    # Get announcement from personality or config
    announcement = None
    try:
        first_pers = loader.load(personalities_list[0])
        announcement = first_pers.announcement
    except ValueError:
        pass

    # Fallback to config if no personality announcement
    if not announcement:
        config_announcements = config.get("announcements", {}).get("messages")
        if config_announcements:
            announcement = (
                config_announcements[0]
                if isinstance(config_announcements, list)
                else config_announcements
            )

    personality_str = ",".join(personalities_list)
    return personality_str, announcement


def _configure_settings(
    personality_str: str | None,
    output_style: str | None,
    mode: str | None,
    session_id: int,
    announcement: str | None,
) -> tuple[dict, str | None, SettingsBuilder]:
    """Configure settings and write to temp file

    Returns:
        Tuple of (settings dict, temp file path, builder for cleanup)
    """
    effective_output_style = output_style or (mode if mode else None)
    builder = SettingsBuilder(
        personality=personality_str,
        output_style=effective_output_style,
        mode=mode,
        session_id=session_id,
        company_announcements=[announcement] if announcement else None,
    )
    settings = builder.build()

    # Write settings to temp file
    settings_path = None
    if settings:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            json.dump(settings, f, indent=2)
            settings_path = f.name
            builder.temp_files.append(settings_path)

    return settings, settings_path, builder


def _handle_session_tracking(
    continue_conv: bool,
    resume: str | None,
    cwd: str,
) -> list[str]:
    """Handle session tracking (continue/resume/new)

    Returns:
        List of command arguments for session handling
    """
    cmd_args = []

    if continue_conv:
        # Continue: resume specific dere session for this directory
        last_session = get_last_session_for_dir(cwd)
        if last_session:
            cmd_args.extend(["--resume", last_session])
        else:
            print("Error: No previous dere session in this directory", file=sys.stderr)
            print("Start a new session with: dere", file=sys.stderr)
            sys.exit(1)
    elif resume:
        # Explicit resume: use provided session ID
        cmd_args.extend(["-r", resume])
    else:
        # New session: generate UUID and track it
        import uuid

        session_uuid = str(uuid.uuid4())
        cmd_args.extend(["--session-id", session_uuid])
        save_session_for_dir(cwd, session_uuid)

    return cmd_args


def _build_claude_command(
    session_args: list[str],
    model: str | None,
    fallback_model: str | None,
    permission_mode: str | None,
    allowed_tools: str | None,
    disallowed_tools: str | None,
    add_dirs: tuple,
    ide: bool,
    settings_path: str | None,
    system_prompt: str,
    print_mode: bool,
    mcp_servers: tuple,
    builder: SettingsBuilder,
    args: list,
) -> tuple[list[str], str | None]:
    """Build the complete claude command

    Returns:
        Tuple of (command list, mcp_config_path)
    """
    cmd = ["claude"]
    cmd.extend(session_args)

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
    if args:
        cmd.append("--")
        cmd.extend(args)

    return cmd, mcp_config_path


def _handle_dry_run(
    cmd: list[str],
    settings_path: str | None,
    mcp_config_path: str | None,
    system_prompt: str,
) -> None:
    """Handle dry run mode - print command and exit"""
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


def _execute_claude(cmd: list[str]) -> None:
    """Execute the claude command"""
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
@click.group(invoke_without_command=True)
@click.option("-P", "--personality", "personalities", multiple=True, help="Personality modes")
@click.option("--output-style", help="Output style override")
@click.option("-p", "--print", "print_mode", is_flag=True, help="Print mode")
@click.option("-c", "--continue", "continue_conv", is_flag=True, help="Continue last conversation")
@click.option("-r", "--resume", help="Resume specific session ID")
@click.option("--bare", is_flag=True, help="Plain Claude, no personality")
@click.option("--mode", help="Plugin/output mode (code, productivity, vault, or output style name)")
@click.option("--model", help="Model override")
@click.option("--fallback-model", help="Fallback model")
@click.option("--permission-mode", help="Permission mode")
@click.option("--allowed-tools", help="Comma-separated allowed tools")
@click.option("--disallowed-tools", help="Comma-separated disallowed tools")
@click.option("--add-dir", "add_dirs", multiple=True, help="Additional directories")
@click.option("--ide", is_flag=True, help="Auto-connect to IDE")
@click.option("--mcp", "mcp_servers", multiple=True, help="MCP servers to use")
@click.option("--dry-run", is_flag=True, help="Print command without executing")
@click.pass_context
def cli(
    ctx,
    personalities,
    output_style,
    print_mode,
    continue_conv,
    resume,
    bare,
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
):
    """Dere - Personality-layered wrapper for Claude Code"""

    # If subcommand is being invoked, don't run claude
    if ctx.invoked_subcommand is not None:
        return

    # Get remaining args from context (after subcommand dispatch)
    args = ctx.args

    # Generate session ID
    session_id = generate_session_id()

    # Set up environment variables
    _setup_environment(
        session_id=session_id,
        mcp_servers=mcp_servers,
        output_style=output_style,
        mode=mode,
        continue_conv=continue_conv,
        resume=resume,
    )

    # Default to tsun if no personality specified and not bare
    personalities_list = list(personalities)
    if not bare and not personalities_list:
        personalities_list = ["tsun"]

    # Load personality and announcements
    personality_str, announcement = _load_personality_and_announcements(personalities_list)

    # Configure settings and write to temp file
    settings, settings_path, builder = _configure_settings(
        personality_str=personality_str,
        output_style=output_style,
        mode=mode,
        session_id=session_id,
        announcement=announcement,
    )

    try:
        # Compose system prompt
        system_prompt = ""
        if not bare and personalities_list:
            system_prompt = compose_system_prompt(personalities_list)

        # Handle session tracking
        cwd = os.getcwd()
        session_args = _handle_session_tracking(continue_conv, resume, cwd)

        # Build claude command
        cmd, mcp_config_path = _build_claude_command(
            session_args=session_args,
            model=model,
            fallback_model=fallback_model,
            permission_mode=permission_mode,
            allowed_tools=allowed_tools,
            disallowed_tools=disallowed_tools,
            add_dirs=add_dirs,
            ide=ide,
            settings_path=settings_path,
            system_prompt=system_prompt,
            print_mode=print_mode,
            mcp_servers=mcp_servers,
            builder=builder,
            args=args,
        )

        # Handle dry run mode
        if dry_run:
            _handle_dry_run(cmd, settings_path, mcp_config_path, system_prompt)
            return

        # Execute claude
        _execute_claude(cmd)

    finally:
        builder.cleanup()


@cli.group(invoke_without_command=True)
@click.pass_context
def daemon(ctx):
    """Daemon management"""
    if ctx.invoked_subcommand is None:
        click.echo(ctx.get_help())


@daemon.command()
def status():
    """Check daemon status"""
    import httpx

    try:
        with httpx.Client() as client:
            response = client.get(f"{DEFAULT_DAEMON_URL}/health", timeout=2.0)
            if response.status_code == 200:
                data = response.json()
                click.echo("Daemon is running")
                click.echo(f"  Database: {data.get('database', 'unknown')}")
                click.echo(f"  DereGraph: {data.get('dere_graph', 'unknown')}")
            else:
                click.echo("Daemon is not responding correctly")
                sys.exit(1)
    except (httpx.ConnectError, httpx.TimeoutException):
        click.echo("Daemon is not running")
        sys.exit(1)
    except Exception as e:
        click.echo(f"Error checking daemon: {e}", err=True)
        sys.exit(1)


@daemon.command()
def start():
    """Start daemon"""
    import subprocess

    data_dir = get_data_dir()
    pid_file = data_dir / "daemon.pid"

    if pid_file.exists():
        click.echo("Daemon appears to be running (PID file exists)")
        click.echo("Use 'dere daemon status' to verify")
        sys.exit(1)

    try:
        subprocess.Popen(
            ["dere-daemon"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        click.echo("Daemon started")
    except Exception as e:
        click.echo(f"Failed to start daemon: {e}", err=True)
        sys.exit(1)


@daemon.command()
def stop():
    """Stop daemon"""
    import signal

    data_dir = get_data_dir()
    pid_file = data_dir / "daemon.pid"

    if not pid_file.exists():
        click.echo("Daemon is not running (no PID file)")
        sys.exit(1)

    try:
        pid = int(pid_file.read_text().strip())
        os.kill(pid, signal.SIGTERM)
        click.echo(f"Sent stop signal to daemon (PID {pid})")
    except ProcessLookupError:
        click.echo("Daemon PID file exists but process not found")
        pid_file.unlink()
    except Exception as e:
        click.echo(f"Failed to stop daemon: {e}", err=True)
        sys.exit(1)


@daemon.command()
def restart():
    """Restart daemon"""
    import subprocess
    import time

    data_dir = get_data_dir()
    pid_file = data_dir / "daemon.pid"

    # Stop if running
    if pid_file.exists():
        try:
            pid = int(pid_file.read_text().strip())
            os.kill(pid, signal.SIGTERM)
            click.echo(f"Stopping daemon (PID {pid})...")
            time.sleep(2)
        except Exception:
            pass

    # Start
    try:
        subprocess.Popen(
            ["dere-daemon"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        click.echo("Daemon restarted")
    except Exception as e:
        click.echo(f"Failed to restart daemon: {e}", err=True)
        sys.exit(1)


@cli.group(invoke_without_command=True)
@click.pass_context
def config(ctx):
    """Configuration management"""
    if ctx.invoked_subcommand is None:
        click.echo(ctx.get_help())


@config.command("show")
def config_show():
    """Show current configuration"""
    config_path = get_config_dir() / "config.toml"
    if not config_path.exists():
        click.echo(f"Config file not found: {config_path}")
        sys.exit(1)

    click.echo(config_path.read_text())


@config.command("path")
def config_path():
    """Show config file path"""
    click.echo(get_config_dir() / "config.toml")


@config.command("edit")
def config_edit():
    """Edit configuration"""
    import subprocess

    config_path = get_config_dir() / "config.toml"
    editor = os.environ.get("EDITOR", "nano")

    try:
        subprocess.run([editor, str(config_path)], check=True)
    except Exception as e:
        click.echo(f"Failed to open editor: {e}", err=True)
        sys.exit(1)


@cli.command()
def version():
    """Show version"""
    click.echo("dere 0.1.0 (Python rewrite)")


if __name__ == "__main__":
    cli()
