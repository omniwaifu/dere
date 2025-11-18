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


def get_dere_plugin_dir() -> Path:
    """Get dere plugin directory for skills loading"""
    import dere_personality

    # dere_personality module is in src/dere_personality/
    plugin_path = Path(dere_personality.__file__).parent
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
        context: bool = False,
        session_id: int | None = None,
        company_announcements: list[str] | None = None,
    ):
        self.personality = personality
        self.output_style = output_style
        self.context = context
        self.session_id = session_id
        self.company_announcements = company_announcements
        self.config_dir = get_config_dir()
        self.temp_files: list[str] = []

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
        """Check if vault plugin should be enabled (in an Obsidian vault)."""
        try:
            from dere_vault.scripts.detect_vault import is_vault

            return is_vault()
        except Exception:
            return False

    def _should_enable_tasks_plugin(self) -> bool:
        """Check if tasks plugin should be enabled (always enabled)."""
        return True  # Tasks plugin always enabled, uses MCP when available

    def _should_enable_wellness_plugin(self) -> bool:
        """Check if wellness plugin should be enabled (always enabled)."""
        return True  # Wellness plugin always enabled for mental health support

    def _should_enable_graph_features_plugin(self) -> bool:
        """Check if graph features plugin should be enabled (always enabled)."""
        return True  # Graph features always enabled for graph extraction

    def _find_plugins_path(self) -> Path | None:
        """Find the dere_plugins directory path."""
        try:
            import dere_personality

            plugin_file = Path(dere_personality.__file__).resolve()

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

        # Enable base dere-personality plugin
        settings["enabledPlugins"]["dere-personality@dere_plugins"] = True

        # Conditionally enable other plugins
        plugin_checks = [
            ("dere-vault@dere_plugins", self._should_enable_vault_plugin),
            ("dere-tasks@dere_plugins", self._should_enable_tasks_plugin),
            ("dere-wellness@dere_plugins", self._should_enable_wellness_plugin),
            ("dere-graph-features@dere_plugins", self._should_enable_graph_features_plugin),
        ]

        for plugin_name, check_fn in plugin_checks:
            try:
                if check_fn():
                    settings["enabledPlugins"][plugin_name] = True
            except Exception:
                # Plugin not available or detection failed
                pass

    def _control_third_party_plugins(self, settings: dict) -> None:
        """Control third-party plugins based on config"""
        try:
            config = load_dere_config()
            plugins_config = config.get("plugins", {})

            # Get workforce assistant config
            workforce_config = plugins_config.get("workforce_assistant", {})
            workforce_mode = workforce_config.get("mode", "auto")
            workforce_directories = workforce_config.get("directories", [])

            # Determine if workforce should be enabled
            enable_workforce = False

            if workforce_mode == "always":
                enable_workforce = True
            elif workforce_mode == "auto":
                # Check if cwd is under any configured directory
                cwd = Path.cwd()
                for directory in workforce_directories:
                    dir_path = Path(directory).expanduser().resolve()
                    try:
                        cwd.relative_to(dir_path)
                        enable_workforce = True
                        break
                    except ValueError:
                        continue
            # else: workforce_mode == "never", leave as False

            # Set plugin state
            if "enabledPlugins" not in settings:
                settings["enabledPlugins"] = {}

            settings["enabledPlugins"]["workforce-assistant@omniwaifu-claude-plugins-local"] = (
                enable_workforce
            )
        except Exception:
            # Silently fail if config loading fails
            pass

    def _add_status_line(self, settings: dict) -> None:
        """Add status line from dere_personality plugin"""
        from pathlib import Path

        plugin_statusline = Path(__file__).parent.parent / "dere_plugins" / "dere_personality" / "scripts" / "dere-statusline.py"

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


# HACK(sweep): Function too long (268 lines), break into smaller functions: _handle_session_tracking(), _build_command(), _configure_settings()
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
):
    """Dere - Personality-layered wrapper for Claude Code"""

    # If subcommand is being invoked, don't run claude
    if ctx.invoked_subcommand is not None:
        return

    # Get remaining args from context (after subcommand dispatch)
    args = ctx.args

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

    # Export personality metadata for statusline
    if personalities_list:
        config_dir = get_config_dir()
        loader = PersonalityLoader(config_dir)
        try:
            first_pers = loader.load(personalities_list[0])
            os.environ["DERE_PERSONALITY_COLOR"] = first_pers.color
            os.environ["DERE_PERSONALITY_ICON"] = first_pers.icon
        except ValueError:
            pass

    # Load config
    config = load_dere_config()

    # Get announcement from personality or config
    announcement = None
    if personalities_list:
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

    # Build settings
    personality_str = ",".join(personalities_list) if personalities_list else None
    effective_output_style = output_style or (mode if mode else None)
    builder = SettingsBuilder(
        personality=personality_str,
        output_style=effective_output_style,
        context=context,
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

    try:
        # Compose system prompt
        system_prompt = ""
        if not bare and personalities_list:
            system_prompt = compose_system_prompt(personalities_list)

        # Build claude command
        cmd = ["claude"]

        # Handle session tracking for continue/resume
        cwd = os.getcwd()

        if continue_conv:
            # Continue: resume specific dere session for this directory
            last_session = get_last_session_for_dir(cwd)
            if last_session:
                cmd.extend(["--resume", last_session])
            else:
                print("Error: No previous dere session in this directory", file=sys.stderr)
                print("Start a new session with: dere", file=sys.stderr)
                sys.exit(1)
        elif resume:
            # Explicit resume: use provided session ID
            cmd.extend(["-r", resume])
        else:
            # New session: generate UUID and track it
            import uuid

            session_uuid = str(uuid.uuid4())
            cmd.extend(["--session-id", session_uuid])
            save_session_for_dir(cwd, session_uuid)

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
            response = client.get("http://localhost:8787/health", timeout=2.0)
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
def queue(ctx):
    """Queue management"""
    if ctx.invoked_subcommand is None:
        click.echo(ctx.get_help())


@queue.command("list")
def queue_list():
    """List queue items"""
    import httpx

    try:
        with httpx.Client() as client:
            response = client.get("http://localhost:8787/queue/status", timeout=5.0)
            response.raise_for_status()
            data = response.json()

            items = data.get("tasks", [])
            if not items:
                click.echo("Queue is empty")
                return

            click.echo(f"\nQueue ({len(items)} items):\n")
            for item in items:
                task_id = item.get("id")
                status = item.get("status", "unknown")
                model = item.get("model_name", "unknown")
                click.echo(f"  [{task_id}] {status} - {model}")

    except (httpx.ConnectError, httpx.TimeoutException):
        click.echo("Error: Cannot connect to daemon", err=True)
        sys.exit(1)
    except Exception as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)


@cli.group(invoke_without_command=True)
@click.pass_context
def history(ctx):
    """View conversation history"""
    if ctx.invoked_subcommand is None:
        click.echo(ctx.get_help())


@history.command("show")
@click.argument("session_id", type=int)
def history_show(session_id):
    """Show conversation history for a session"""
    import httpx

    try:
        with httpx.Client() as client:
            response = client.get(
                f"http://localhost:8787/sessions/{session_id}/history", timeout=5.0
            )
            response.raise_for_status()
            data = response.json()

            messages = data.get("messages", [])
            if not messages:
                click.echo(f"No history found for session {session_id}")
                return

            click.echo(f"\nSession {session_id} history ({len(messages)} messages):\n")
            for msg in messages:
                role = msg.get("message_type", "unknown")
                content = msg.get("prompt", "")[:100]
                click.echo(f"  [{role}] {content}...")

    except (httpx.ConnectError, httpx.TimeoutException):
        click.echo("Error: Cannot connect to daemon", err=True)
        sys.exit(1)
    except Exception as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)


@cli.group(invoke_without_command=True)
@click.pass_context
def entities(ctx):
    """View and search extracted entities"""
    if ctx.invoked_subcommand is None:
        click.echo(ctx.get_help())


@entities.command("info")
@click.argument("entity")
@click.option("--user-id", help="User ID to filter by")
def entities_info(entity, user_id):
    """Show information about an entity from the knowledge graph"""
    import httpx

    daemon_url = "http://localhost:8787"

    try:
        params = {}
        if user_id:
            params["user_id"] = user_id

        with httpx.Client() as client:
            response = client.get(f"{daemon_url}/kg/entity/{entity}", params=params, timeout=5.0)
            response.raise_for_status()
            data = response.json()

            if not data.get("found"):
                click.echo(f"Entity not found: {entity}")
                return

            click.echo(f"\nEntity: {entity}")
            click.echo("-" * 80)

            # Show primary node
            primary = data.get("primary_node", {})
            click.echo(f"Name: {primary.get('name')}")
            click.echo(f"Labels: {', '.join(primary.get('labels', []))}")
            click.echo(f"Created: {primary.get('created_at', 'unknown')}")

            # Show related nodes
            related = data.get("related_nodes", [])
            if related:
                click.echo(f"\nRelated entities ({len(related)}):")
                for rel in related[:10]:  # Show first 10
                    click.echo(f"  - {rel.get('name')} ({', '.join(rel.get('labels', []))})")

            # Show relationships
            relationships = data.get("relationships", [])
            if relationships:
                click.echo(f"\nRelationships ({len(relationships)}):")
                for rel in relationships[:10]:  # Show first 10
                    click.echo(f"  - {rel.get('fact')}")

    except (httpx.ConnectError, httpx.TimeoutException):
        click.echo("Error: Cannot connect to daemon. Is it running?", err=True)
        sys.exit(1)
    except httpx.HTTPError as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)


@entities.command("related")
@click.argument("entity")
@click.option("--limit", default=20, help="Max number of related entities")
@click.option("--user-id", help="User ID to filter by")
def entities_related(entity, limit, user_id):
    """Show entities related to given entity via knowledge graph"""
    import httpx

    daemon_url = "http://localhost:8787"

    try:
        params = {"limit": limit}
        if user_id:
            params["user_id"] = user_id

        with httpx.Client() as client:
            response = client.get(
                f"{daemon_url}/kg/entity/{entity}/related", params=params, timeout=5.0
            )
            response.raise_for_status()
            data = response.json()

            if not data.get("found"):
                click.echo(f"Entity not found: {entity}")
                return

            related = data.get("related", [])
            if not related:
                click.echo(f"No related entities found for: {entity}")
                return

            click.echo(f"\nEntities related to: {entity}")
            click.echo("-" * 80)

            for rel in related:
                name = rel.get("name")
                labels = ", ".join(rel.get("labels", []))
                click.echo(f"  - {name} ({labels})")

            click.echo(f"\nTotal: {len(related)} related entities")

    except (httpx.ConnectError, httpx.TimeoutException):
        click.echo("Error: Cannot connect to daemon. Is it running?", err=True)
        sys.exit(1)
    except httpx.HTTPError as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)


@cli.group(invoke_without_command=True)
@click.pass_context
def summaries(ctx):
    """View session summaries"""
    if ctx.invoked_subcommand is None:
        click.echo(ctx.get_help())


@summaries.command("list")
def summaries_list():
    """List recent session summaries"""
    click.echo("Summary listing not yet implemented")
    click.echo("Will show recent session summaries from database")


@cli.group(invoke_without_command=True)
@click.pass_context
def stats(ctx):
    """View statistics"""
    if ctx.invoked_subcommand is None:
        click.echo(ctx.get_help())


@stats.command("show")
def stats_show():
    """Show system statistics"""
    click.echo("Statistics not yet implemented")
    click.echo("Will show session counts, entity counts, etc.")


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


@cli.group(invoke_without_command=True)
@click.pass_context
def synthesis(ctx):
    """Knowledge synthesis and pattern detection"""
    if ctx.invoked_subcommand is None:
        click.echo(ctx.get_help())


@synthesis.command("insights")
@click.option("--personality", "-p", multiple=True, help="Personality combo (e.g., -p tsun)")
@click.option("--limit", type=int, default=10, help="Maximum number of insights to show")
@click.option("--no-format", is_flag=True, help="Disable personality formatting")
def synthesis_insights(personality, limit, no_format):
    """Show synthesized insights"""
    import httpx

    daemon_url = "http://localhost:8787"

    if not personality:
        click.echo("Error: --personality is required (e.g., --personality tsun)", err=True)
        sys.exit(1)

    try:
        payload = {
            "personality_combo": list(personality),
            "limit": limit,
            "format_with_personality": not no_format,
        }

        with httpx.Client() as client:
            response = client.post(
                f"{daemon_url}/api/synthesis/insights", json=payload, timeout=10.0
            )
            response.raise_for_status()
            data = response.json()

            insights = data.get("insights", [])
            if not insights:
                click.echo(f"No insights found for personality: {', '.join(personality)}")
                return

            click.echo(f"\nInsights for personality: {', '.join(personality)}")
            click.echo("=" * 80)

            for idx, insight in enumerate(insights, 1):
                insight_type = insight.get("insight_type", "unknown")
                content = insight.get("content", "")
                confidence = insight.get("confidence", 0)
                created_at = insight.get("created_at", "")

                click.echo(f"\n[{idx}] {insight_type.upper()} (confidence: {confidence:.2f})")
                click.echo(f"    {content}")
                if created_at:
                    click.echo(f"    Generated: {created_at}")

            click.echo(f"\nTotal: {len(insights)} insights")

    except (httpx.ConnectError, httpx.TimeoutException):
        click.echo("Error: Cannot connect to daemon. Is it running?", err=True)
        sys.exit(1)
    except httpx.HTTPError as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)


@synthesis.command("patterns")
@click.option("--personality", "-p", multiple=True, help="Personality combo (e.g., -p tsun)")
@click.option("--limit", type=int, default=10, help="Maximum number of patterns to show")
@click.option("--no-format", is_flag=True, help="Disable personality formatting")
def synthesis_patterns(personality, limit, no_format):
    """Show detected patterns"""
    import httpx

    daemon_url = "http://localhost:8787"

    if not personality:
        click.echo("Error: --personality is required (e.g., --personality tsun)", err=True)
        sys.exit(1)

    try:
        payload = {
            "personality_combo": list(personality),
            "limit": limit,
            "format_with_personality": not no_format,
        }

        with httpx.Client() as client:
            response = client.post(
                f"{daemon_url}/api/synthesis/patterns", json=payload, timeout=10.0
            )
            response.raise_for_status()
            data = response.json()

            patterns = data.get("patterns", [])
            if not patterns:
                click.echo(f"No patterns found for personality: {', '.join(personality)}")
                return

            click.echo(f"\nPatterns for personality: {', '.join(personality)}")
            click.echo("=" * 80)

            for idx, pattern in enumerate(patterns, 1):
                pattern_type = pattern.get("pattern_type", "unknown")
                description = pattern.get("description", "")
                frequency = pattern.get("frequency", 0)
                created_at = pattern.get("created_at", "")

                click.echo(f"\n[{idx}] {pattern_type.upper()} (frequency: {frequency})")
                click.echo(f"    {description}")
                if created_at:
                    click.echo(f"    Detected: {created_at}")

            click.echo(f"\nTotal: {len(patterns)} patterns")

    except (httpx.ConnectError, httpx.TimeoutException):
        click.echo("Error: Cannot connect to daemon. Is it running?", err=True)
        sys.exit(1)
    except httpx.HTTPError as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)


@synthesis.command("run")
@click.option("--personality", "-p", multiple=True, help="Personality combo (e.g., -p tsun)")
@click.option("--user-session", type=int, help="User session ID to synthesize")
def synthesis_run(personality, user_session):
    """Manually trigger synthesis"""
    import httpx

    daemon_url = "http://localhost:8787"

    if not personality:
        click.echo("Error: --personality is required (e.g., --personality tsun)", err=True)
        sys.exit(1)

    try:
        payload = {
            "personality_combo": list(personality),
            "user_session_id": user_session,
        }

        click.echo(f"Running synthesis for personality: {', '.join(personality)}...")

        with httpx.Client() as client:
            response = client.post(f"{daemon_url}/api/synthesis/run", json=payload, timeout=60.0)
            response.raise_for_status()
            data = response.json()

            if data.get("success"):
                click.echo("\nSynthesis completed successfully!")
                click.echo(f"  Sessions analyzed: {data.get('total_sessions', 0)}")
                click.echo(f"  Insights generated: {data.get('insights_generated', 0)}")
                click.echo(f"  Patterns detected: {data.get('patterns_detected', 0)}")
                click.echo(f"  Entity collisions resolved: {data.get('entity_collisions', 0)}")
            else:
                click.echo("Synthesis failed", err=True)
                sys.exit(1)

    except (httpx.ConnectError, httpx.TimeoutException):
        click.echo("Error: Cannot connect to daemon. Is it running?", err=True)
        sys.exit(1)
    except httpx.TimeoutException:
        click.echo("Error: Synthesis request timed out (taking longer than 60s)", err=True)
        sys.exit(1)
    except httpx.HTTPError as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)


@cli.command()
def version():
    """Show version"""
    click.echo("dere 0.1.0 (Python rewrite)")


if __name__ == "__main__":
    cli()
