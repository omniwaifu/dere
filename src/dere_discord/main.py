"""CLI entrypoint for dere-discord."""

from __future__ import annotations

import asyncio
import sys
from collections.abc import Iterable

import click
from loguru import logger

from .agent import DiscordAgent
from .bot import DereDiscordClient
from .config import ConfigError, DiscordBotConfig, load_discord_config
from .daemon import DaemonClient
from .persona import PersonaService
from .session import SessionManager


def _format_collection(values: Iterable[str]) -> str:
    if not values:
        return "—"
    return ", ".join(sorted(values))


@click.command(context_settings={"help_option_names": ["-h", "--help"]})
@click.option(
    "--token",
    metavar="TOKEN",
    help="Discord bot token override (otherwise reads DERE_DISCORD_TOKEN or config.toml).",
)
@click.option(
    "--persona",
    "persona_overrides",
    multiple=True,
    metavar="NAME",
    help="Default persona(s) for new Discord channels; repeat for combos.",
)
@click.option(
    "--guild",
    "guild_allowlist",
    multiple=True,
    metavar="GUILD_ID",
    help="Limit bot usage to specified guild IDs.",
)
@click.option(
    "--channel",
    "channel_allowlist",
    multiple=True,
    metavar="CHANNEL_ID",
    help="Limit bot usage to specified channel IDs.",
)
@click.option(
    "--idle-timeout",
    type=int,
    metavar="SECONDS",
    help="Seconds of inactivity before ending a session (default 1200).",
)
@click.option(
    "--summary-grace",
    type=int,
    metavar="SECONDS",
    help="Delay between idle trigger and summarization request (default 30).",
)
@click.option(
    "--context/--no-context",
    "context_flag",
    default=None,
    help="Enable or disable contextual prompt enrichment (default: enabled).",
)
def cli(
    token: str | None,
    persona_overrides: tuple[str, ...],
    guild_allowlist: tuple[str, ...],
    channel_allowlist: tuple[str, ...],
    idle_timeout: int | None,
    summary_grace: int | None,
    context_flag: bool | None,
):
    """Launch the dere Discord bot."""

    try:
        config = load_discord_config(
            token_override=token,
            persona_override=",".join(persona_overrides) if persona_overrides else None,
            allow_guilds=guild_allowlist or None,
            allow_channels=channel_allowlist or None,
            idle_timeout_override=idle_timeout,
            summary_grace_override=summary_grace,
            context_override=context_flag,
        )
    except ConfigError as exc:
        raise click.ClickException(str(exc)) from exc

    _configure_logging()
    _display_config(config)

    try:
        asyncio.run(_run_bot(config))
    except KeyboardInterrupt:
        click.echo("Stopping dere-discord...", err=True)


def _display_config(config: DiscordBotConfig) -> None:
    """Print a human-friendly configuration summary."""
    click.echo("Dere Discord configuration:")
    click.echo(f"  Persona         : {', '.join(config.default_personas)}")
    click.echo(f"  Idle timeout    : {config.idle_timeout_seconds}s")
    click.echo(f"  Summary grace   : {config.summary_grace_seconds}s")
    click.echo(f"  Context         : {'on' if config.context_enabled else 'off'}")
    click.echo(f"  Session expiry  : {config.session_expiry_hours}h")
    click.echo(f"  Guilds          : {_format_collection(config.allowed_guilds)}")
    click.echo(f"  Channels        : {_format_collection(config.allowed_channels)}")


def run() -> None:
    """Console script entrypoint."""
    cli(standalone_mode=True)


def _configure_logging() -> None:
    logger.remove()
    logger.add(
        sys.stderr,
        level="INFO",
        format="<green>{time:HH:mm:ss}</green> | <level>{level: <8}</level> | <cyan>{name}</cyan>"
        " | {message}",
    )
    logger.disable("httpx")


async def _run_bot(config: DiscordBotConfig) -> None:
    persona_service = PersonaService(config.default_personas)
    daemon = DaemonClient()
    sessions = SessionManager(config, daemon, persona_service)
    agent = DiscordAgent(sessions, context_enabled=config.context_enabled)
    client = DereDiscordClient(
        config=config,
        sessions=sessions,
        agent=agent,
        persona_service=persona_service,
        daemon_client=daemon,
    )

    try:
        await client.start(config.token)
    finally:
        if not client.is_closed():
            await client.close()
