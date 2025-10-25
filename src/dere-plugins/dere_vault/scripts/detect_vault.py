#!/usr/bin/env python3
"""Detect if current working directory is inside a knowledge vault."""

from __future__ import annotations

import sys
from pathlib import Path


def is_vault(path: Path | None = None) -> bool:
    """Check if path is inside a knowledge vault.

    A directory is considered a vault if it or any parent contains:
    - .obsidian directory (Obsidian vault)
    - CLAUDE.md file (vault instructions)
    """
    if path is None:
        path = Path.cwd()

    current = path.resolve()

    # Check current and all parents up to root
    while current != current.parent:
        # Check for Obsidian vault markers
        if (current / ".obsidian").is_dir():
            return True

        # Check for CLAUDE.md (vault instructions)
        if (current / "CLAUDE.md").is_file():
            return True

        current = current.parent

    return False


def find_vault_root(path: Path | None = None) -> Path | None:
    """Find the root directory of the vault containing path.

    Returns None if not in a vault.
    """
    if path is None:
        path = Path.cwd()

    current = path.resolve()

    while current != current.parent:
        if (current / ".obsidian").is_dir() or (current / "CLAUDE.md").is_file():
            return current

        current = current.parent

    return None


if __name__ == "__main__":
    # CLI usage: exit 0 if in vault, exit 1 if not
    if is_vault():
        vault_root = find_vault_root()
        print(f"Vault detected: {vault_root}")
        sys.exit(0)
    else:
        print("Not in a vault")
        sys.exit(1)
