"""CLI entry point for dere-obsidian."""

from __future__ import annotations

import sys
from pathlib import Path

import click
import uvicorn
from loguru import logger

from .server import create_app


@click.group()
def cli():
    """dere-obsidian: OpenAI-compatible API for Obsidian QuickAdd integration."""
    pass


@cli.command()
@click.option(
    "--vault",
    "-v",
    type=click.Path(exists=True, file_okay=False, dir_okay=True, path_type=Path),
    required=True,
    help="Path to Obsidian vault",
)
@click.option(
    "--port",
    "-p",
    type=int,
    default=8770,
    help="Port to run server on (default: 8770)",
)
@click.option(
    "--host",
    "-h",
    type=str,
    default="127.0.0.1",
    help="Host to bind to (default: 127.0.0.1)",
)
@click.option(
    "--daemon-url",
    "-d",
    type=str,
    default=None,
    help="URL of dere-daemon for session/emotion integration (optional)",
)
@click.option(
    "--enable-sessions",
    is_flag=True,
    help="Enable daemon session creation for cross-medium continuity",
)
@click.option(
    "--reload",
    is_flag=True,
    help="Enable auto-reload on code changes (development)",
)
def serve(
    vault: Path,
    port: int,
    host: str,
    daemon_url: str | None,
    enable_sessions: bool,
    reload: bool,
):
    """Start the dere-obsidian server."""
    logger.info("Starting dere-obsidian server")
    logger.info(f"Vault: {vault}")
    logger.info(f"Server: http://{host}:{port}")

    if daemon_url:
        logger.info(f"Daemon: {daemon_url}")
        if enable_sessions:
            logger.info("Sessions: enabled (cross-medium continuity)")
        else:
            logger.info("Sessions: disabled (stateless mode)")
    else:
        logger.info("Daemon: not configured (stateless mode)")

    # Create app
    app = create_app(
        vault_path=vault,
        daemon_url=daemon_url,
        enable_sessions=enable_sessions,
    )

    # Run server
    uvicorn.run(
        app,
        host=host,
        port=port,
        reload=reload,
        log_level="info",
    )


def main():
    """Main entry point."""
    try:
        cli()
    except KeyboardInterrupt:
        logger.info("Shutting down...")
        sys.exit(0)
    except Exception as e:
        logger.exception(f"Fatal error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
