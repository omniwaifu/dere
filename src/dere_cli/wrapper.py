"""Claude wrapper - handles personality, settings, and passthrough."""
from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from dere_cli.mcp import build_mcp_config
from dere_shared.config import load_dere_config
from dere_shared.constants import DEFAULT_DAEMON_URL
from dere_shared.paths import get_config_dir
from dere_shared.personalities import PersonalityLoader


def generate_session_id() -> int:
    return int(time.time_ns() % (1 << 31))


class SettingsBuilder:
    """Build Claude settings JSON for interactive mode."""

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
        settings = {"hooks": {}, "statusLine": {}, "env": {}}

        output_style_to_use = self.output_style
        if not output_style_to_use:
            try:
                from dere_plugins.dere_vault.scripts.detect_vault import is_vault
                if is_vault():
                    output_style_to_use = "dere-vault:vault"
            except Exception:
                pass

        if output_style_to_use:
            settings["outputStyle"] = output_style_to_use

        if self.company_announcements:
            settings["companyAnnouncements"] = self.company_announcements

        self._add_dere_plugins(settings)
        self._add_status_line(settings)
        self._add_hook_environment(settings)

        return settings

    def _should_enable_vault_plugin(self) -> bool:
        if self.mode == "vault":
            return True
        try:
            from dere_plugins.dere_vault.scripts.detect_vault import is_vault
            return is_vault()
        except Exception:
            return False

    def _should_enable_productivity_plugin(self) -> bool:
        if self.mode in ("productivity", "tasks"):
            return True
        try:
            config = load_dere_config()
            mode = config.get("plugins", {}).get("dere_productivity", {}).get("mode", "never")
            return mode == "always"
        except Exception:
            return False

    def _should_enable_graph_features_plugin(self) -> bool:
        if self.mode == "code":
            return False
        try:
            import httpx
            with httpx.Client() as client:
                response = client.get(f"{DEFAULT_DAEMON_URL}/health", timeout=0.5)
                return response.status_code == 200
        except Exception:
            return False

    def _should_enable_code_plugin(self) -> bool:
        if self.mode == "code":
            return True
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
        except Exception:
            return False

    def _find_plugins_path(self) -> Path | None:
        # Prefer a local checkout: walk upward and look for `src/dere_plugins`.
        cwd = Path.cwd()
        for parent in [cwd, *cwd.parents]:
            candidate = parent / "src" / "dere_plugins"
            if (candidate / ".claude-plugin" / "marketplace.json").exists():
                return candidate

        # Fallback: if running from an installed package, we may not have a marketplace
        # manifest available. In that case, don't attempt to configure a local marketplace.
        return None

    def _add_dere_plugins(self, settings: dict) -> None:
        plugins_path = self._find_plugins_path()
        if not plugins_path:
            return

        settings.setdefault("extraKnownMarketplaces", {})
        settings["extraKnownMarketplaces"]["dere_plugins"] = {
            "source": {"source": "directory", "path": str(plugins_path)}
        }

        settings.setdefault("enabledPlugins", {})
        settings["enabledPlugins"]["dere-core@dere_plugins"] = True

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
                    if mode_name:
                        self.enabled_plugins.append(mode_name)
            except Exception:
                pass

    def _add_status_line(self, settings: dict) -> None:
        plugin_statusline = (
            Path(__file__).parent.parent / "dere_plugins" / "dere_core" / "scripts" / "dere-statusline.py"
        )
        if plugin_statusline.exists():
            settings["statusLine"] = {
                "type": "command",
                "command": str(plugin_statusline),
                "padding": 0,
            }

    def _add_hook_environment(self, settings: dict) -> None:
        # Ensure hooks/MCP servers run with the same Python environment as `dere`.
        # This fixes cases where plugin hooks run under system `python3` and can't import dere modules.
        try:
            python_bin_dir = str(Path(sys.executable).resolve().parent)
            existing_path = os.environ.get("PATH", "")
            settings["env"]["PATH"] = (
                f"{python_bin_dir}{os.pathsep}{existing_path}" if existing_path else python_bin_dir
            )
        except Exception:
            pass

        # Provide an explicit PYTHONPATH for hooks that use /usr/bin/env python3.
        try:
            import dere_shared  # noqa: PLC0415

            site_root = str(Path(dere_shared.__file__).resolve().parent.parent)
            plugins_root = str(Path(site_root) / "dere_plugins")
            existing_pythonpath = os.environ.get("PYTHONPATH", "")
            pythonpath_parts = []
            if Path(plugins_root).exists():
                pythonpath_parts.append(plugins_root)
            pythonpath_parts.append(site_root)
            if existing_pythonpath:
                pythonpath_parts.append(existing_pythonpath)
            pythonpath_value = os.pathsep.join(pythonpath_parts)
            settings["env"]["PYTHONPATH"] = pythonpath_value
            settings["env"]["DERE_PYTHONPATH"] = pythonpath_value
        except Exception:
            pass

        if self.personality:
            settings["env"]["DERE_PERSONALITY"] = self.personality
        settings["env"]["DERE_DAEMON_URL"] = DEFAULT_DAEMON_URL
        if self.mode in ("productivity", "tasks"):
            settings["env"]["DERE_PRODUCTIVITY"] = "true"
        if self.enabled_plugins:
            settings["env"]["DERE_ENABLED_PLUGINS"] = "/".join(self.enabled_plugins)
        if self.session_id:
            settings["env"]["DERE_SESSION_ID"] = str(self.session_id)

        # Google Calendar MCP: auto-provide credentials path if available.
        # @cocal/google-calendar-mcp expects GOOGLE_OAUTH_CREDENTIALS to point to the OAuth JSON file.
        try:
            if (
                self.mode in ("productivity", "tasks")
                or "productivity" in self.enabled_plugins
                or self._should_enable_productivity_plugin()
            ):
                if "GOOGLE_OAUTH_CREDENTIALS" not in settings["env"]:
                    env_creds = os.environ.get("GOOGLE_OAUTH_CREDENTIALS")
                    if env_creds:
                        settings["env"]["GOOGLE_OAUTH_CREDENTIALS"] = env_creds
                    else:
                        home = Path.home()
                        candidates = [
                            home / ".config" / "google-calendar-mcp" / "gcp-oauth.keys.json",
                            home / ".config" / "google-calendar-mcp" / "credentials.json",
                            home / ".config" / "google-calendar-mcp" / "google-calendar-credentials.json",
                            home / ".config" / "dere" / "gcp-oauth.keys.json",
                            home / ".config" / "dere" / "google-calendar-credentials.json",
                        ]
                        for candidate in candidates:
                            if candidate.exists():
                                settings["env"]["GOOGLE_OAUTH_CREDENTIALS"] = str(candidate)
                                break
        except Exception:
            pass

    def cleanup(self):
        for temp_file in self.temp_files:
            try:
                os.unlink(temp_file)
            except Exception:
                pass


def compose_system_prompt(personalities: list[str]) -> str:
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


def run_claude(args: list[str]) -> None:
    """Run claude with dere settings, passing through unknown args."""
    # Dere-specific options we extract
    personalities: list[str] = []
    output_style: str | None = None
    continue_conv = False
    resume: str | None = None
    bare = False
    mode: str | None = None
    model: str | None = None
    fallback_model: str | None = None
    permission_mode: str | None = None
    allowed_tools: str | None = None
    disallowed_tools: str | None = None
    add_dirs: list[str] = []
    ide = False
    mcp_servers: list[str] = []
    dry_run = False
    passthrough: list[str] = []

    # Parse - extract dere options, pass rest through
    i = 0
    while i < len(args):
        arg = args[i]
        if arg in ("-P", "--personality") and i + 1 < len(args):
            personalities.append(args[i + 1])
            i += 2
        elif arg == "--output-style" and i + 1 < len(args):
            output_style = args[i + 1]
            i += 2
        elif arg in ("-c", "--continue"):
            continue_conv = True
            i += 1
        elif arg in ("-r", "--resume") and i + 1 < len(args):
            resume = args[i + 1]
            i += 2
        elif arg == "--bare":
            bare = True
            i += 1
        elif arg == "--mode" and i + 1 < len(args):
            mode = args[i + 1]
            i += 2
        elif arg == "--model" and i + 1 < len(args):
            model = args[i + 1]
            i += 2
        elif arg == "--fallback-model" and i + 1 < len(args):
            fallback_model = args[i + 1]
            i += 2
        elif arg == "--permission-mode" and i + 1 < len(args):
            permission_mode = args[i + 1]
            i += 2
        elif arg == "--allowed-tools" and i + 1 < len(args):
            allowed_tools = args[i + 1]
            i += 2
        elif arg == "--disallowed-tools" and i + 1 < len(args):
            disallowed_tools = args[i + 1]
            i += 2
        elif arg == "--add-dir" and i + 1 < len(args):
            add_dirs.append(args[i + 1])
            i += 2
        elif arg == "--ide":
            ide = True
            i += 1
        elif arg == "--mcp" and i + 1 < len(args):
            mcp_servers.append(args[i + 1])
            i += 2
        elif arg == "--dry-run":
            dry_run = True
            i += 1
        elif arg == "--":
            passthrough.extend(args[i + 1:])
            break
        else:
            passthrough.append(arg)
            i += 1

    # Session setup
    session_id = generate_session_id()
    os.environ["DERE_SESSION_ID"] = str(session_id)
    if mcp_servers:
        os.environ["DERE_MCP_SERVERS"] = ",".join(mcp_servers)
    if output_style:
        os.environ["DERE_OUTPUT_STYLE"] = output_style
    if mode:
        os.environ["DERE_MODE"] = mode
    os.environ["DERE_SESSION_TYPE"] = "continue" if continue_conv else "resume" if resume else "new"

    # Default personality
    if not bare and not personalities:
        personalities = ["tsun"]

    # Load personality metadata
    personality_str = ",".join(personalities) if personalities else None
    announcement = None
    if personalities:
        config_dir = get_config_dir()
        loader = PersonalityLoader(config_dir)
        config = load_dere_config()
        try:
            first_pers = loader.load(personalities[0])
            os.environ["DERE_PERSONALITY_COLOR"] = first_pers.color
            os.environ["DERE_PERSONALITY_ICON"] = first_pers.icon
            announcement = first_pers.announcement
        except ValueError:
            pass
        if not announcement:
            config_announcements = config.get("announcements", {}).get("messages")
            if config_announcements:
                announcement = config_announcements[0] if isinstance(config_announcements, list) else config_announcements

    # Build settings
    effective_output_style = output_style or mode
    builder = SettingsBuilder(
        personality=personality_str,
        output_style=effective_output_style,
        mode=mode,
        session_id=session_id,
        company_announcements=[announcement] if announcement else None,
    )
    settings = builder.build()

    settings_path = None
    if settings:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
            json.dump(settings, f, indent=2)
            settings_path = f.name
            builder.temp_files.append(settings_path)

    try:
        # System prompt
        system_prompt = ""
        if not bare and personalities:
            system_prompt = compose_system_prompt(personalities)

        # Build command
        cmd = ["claude"]
        if continue_conv:
            cmd.append("--continue")
        elif resume:
            cmd.extend(["-r", resume])
        if model:
            cmd.extend(["--model", model])
        if fallback_model:
            cmd.extend(["--fallback-model", fallback_model])
        if permission_mode:
            cmd.extend(["--permission-mode", permission_mode])
        if allowed_tools:
            cmd.extend(["--allowed-tools", allowed_tools])
        if disallowed_tools:
            cmd.extend(["--disallowed-tools", disallowed_tools])
        for d in add_dirs:
            cmd.extend(["--add-dir", d])
        if ide:
            cmd.append("--ide")
        if settings_path:
            cmd.extend(["--settings", settings_path])
        if system_prompt:
            cmd.extend(["--append-system-prompt", system_prompt])

        mcp_config_path = None
        if mcp_servers:
            try:
                mcp_config_path = build_mcp_config(list(mcp_servers), get_config_dir())
                if mcp_config_path:
                    cmd.extend(["--mcp-config", mcp_config_path])
                    builder.temp_files.append(mcp_config_path)
            except ValueError as e:
                print(f"Error: {e}", file=sys.stderr)
                sys.exit(1)

        if passthrough:
            cmd.extend(passthrough)

        if dry_run:
            print("Command:", " ".join(cmd))
            print("\nEnvironment:")
            for k in sorted(os.environ):
                if k.startswith("DERE_"):
                    print(f"  {k}={os.environ[k]}")
            if settings_path:
                print(f"\nSettings: {settings_path}")
                print(Path(settings_path).read_text())
            return

        # Execute
        process = subprocess.Popen(cmd, stdin=sys.stdin, stdout=sys.stdout, stderr=sys.stderr)

        def handler(signum, frame):
            process.send_signal(signum)

        signal.signal(signal.SIGINT, handler)
        signal.signal(signal.SIGTERM, handler)
        process.wait()
        sys.exit(process.returncode)

    except FileNotFoundError:
        print("Error: 'claude' not found. Install Claude CLI.", file=sys.stderr)
        sys.exit(1)
    finally:
        builder.cleanup()
