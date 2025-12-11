#!/usr/bin/env python3
"""Dere CLI - transparent wrapper for claude with personality support."""
from __future__ import annotations

import sys


def app():
    """Main entry point - subcommands use typer, everything else passes through."""
    args = sys.argv[1:]

    # Known subcommands handled by typer
    if args and args[0] in ("daemon", "config", "version", "--help", "-h"):
        from dere_cli.subcommands import typer_app
        typer_app()
        return

    # Everything else: run claude wrapper
    from dere_cli.wrapper import run_claude
    run_claude(args)


if __name__ == "__main__":
    app()
