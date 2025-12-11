"""Typer subcommands for dere CLI."""
from __future__ import annotations

import os
import signal
import subprocess
import sys
import time

import typer

from dere_shared.constants import DEFAULT_DAEMON_URL
from dere_shared.paths import get_config_dir, get_data_dir

typer_app = typer.Typer(help="Dere - Personality-layered wrapper for Claude Code")
daemon_app = typer.Typer(help="Daemon management")
config_app = typer.Typer(help="Configuration management")

typer_app.add_typer(daemon_app, name="daemon")
typer_app.add_typer(config_app, name="config")


@typer_app.callback(invoke_without_command=True)
def main_callback(ctx: typer.Context):
    """Dere - Personality-layered wrapper for Claude Code"""
    if ctx.invoked_subcommand is None:
        print(ctx.get_help())


# Daemon commands
@daemon_app.callback(invoke_without_command=True)
def daemon_callback(ctx: typer.Context):
    """Daemon management"""
    if ctx.invoked_subcommand is None:
        print(ctx.get_help())


@daemon_app.command()
def status():
    """Check daemon status"""
    import httpx

    try:
        with httpx.Client() as client:
            response = client.get(f"{DEFAULT_DAEMON_URL}/health", timeout=2.0)
            if response.status_code == 200:
                data = response.json()
                print("Daemon is running")
                print(f"  Database: {data.get('database', 'unknown')}")
                print(f"  DereGraph: {data.get('dere_graph', 'unknown')}")
            else:
                print("Daemon is not responding correctly")
                sys.exit(1)
    except (httpx.ConnectError, httpx.TimeoutException):
        print("Daemon is not running")
        sys.exit(1)
    except Exception as e:
        print(f"Error checking daemon: {e}", file=sys.stderr)
        sys.exit(1)


@daemon_app.command()
def start():
    """Start daemon"""
    data_dir = get_data_dir()
    pid_file = data_dir / "daemon.pid"

    if pid_file.exists():
        print("Daemon appears to be running (PID file exists)")
        print("Use 'dere daemon status' to verify")
        sys.exit(1)

    try:
        subprocess.Popen(
            ["dere-daemon"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        print("Daemon started")
    except Exception as e:
        print(f"Failed to start daemon: {e}", file=sys.stderr)
        sys.exit(1)


@daemon_app.command()
def stop():
    """Stop daemon"""
    data_dir = get_data_dir()
    pid_file = data_dir / "daemon.pid"

    if not pid_file.exists():
        print("Daemon is not running (no PID file)")
        sys.exit(1)

    try:
        pid = int(pid_file.read_text().strip())
        os.kill(pid, signal.SIGTERM)
        print(f"Sent stop signal to daemon (PID {pid})")
    except ProcessLookupError:
        print("Daemon PID file exists but process not found")
        pid_file.unlink()
    except Exception as e:
        print(f"Failed to stop daemon: {e}", file=sys.stderr)
        sys.exit(1)


@daemon_app.command()
def restart():
    """Restart daemon"""
    data_dir = get_data_dir()
    pid_file = data_dir / "daemon.pid"

    if pid_file.exists():
        try:
            pid = int(pid_file.read_text().strip())
            os.kill(pid, signal.SIGTERM)
            print(f"Stopping daemon (PID {pid})...")
            time.sleep(2)
        except Exception:
            pass

    try:
        subprocess.Popen(
            ["dere-daemon"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=True,
        )
        print("Daemon restarted")
    except Exception as e:
        print(f"Failed to restart daemon: {e}", file=sys.stderr)
        sys.exit(1)


# Config commands
@config_app.callback(invoke_without_command=True)
def config_callback(ctx: typer.Context):
    """Configuration management"""
    if ctx.invoked_subcommand is None:
        print(ctx.get_help())


@config_app.command("show")
def config_show():
    """Show current configuration"""
    config_path = get_config_dir() / "config.toml"
    if not config_path.exists():
        print(f"Config file not found: {config_path}")
        sys.exit(1)
    print(config_path.read_text())


@config_app.command("path")
def config_path_cmd():
    """Show config file path"""
    print(get_config_dir() / "config.toml")


@config_app.command("edit")
def config_edit():
    """Edit configuration"""
    config_file = get_config_dir() / "config.toml"
    editor = os.environ.get("EDITOR", "nano")
    try:
        subprocess.run([editor, str(config_file)], check=True)
    except Exception as e:
        print(f"Failed to open editor: {e}", file=sys.stderr)
        sys.exit(1)


@typer_app.command()
def version():
    """Show version"""
    print("dere 0.1.0")
