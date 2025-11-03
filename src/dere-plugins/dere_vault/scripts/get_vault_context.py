#!/usr/bin/env python3
"""Get vault-specific context for augmenting prompts."""

from __future__ import annotations

import sys
from pathlib import Path

from detect_vault import find_vault_root


def get_vault_context(vault_root: Path | None = None) -> str:
    """Get vault context from CLAUDE.md files.

    Returns combined context from:
    - Root CLAUDE.md (if exists)
    - Any folder-specific CLAUDE.md in current path

    Returns empty string if not in vault.
    """
    if vault_root is None:
        vault_root = find_vault_root()

    if vault_root is None:
        return ""

    context_parts = []
    cwd = Path.cwd().resolve()

    # Read root CLAUDE.md if exists
    root_claude = vault_root / "CLAUDE.md"
    if root_claude.is_file():
        content = root_claude.read_text(encoding="utf-8")
        context_parts.append(f"# Vault Context\n\n{content}")

    # Read folder-specific CLAUDE.md files in path from vault root to cwd
    try:
        relative_path = cwd.relative_to(vault_root)
        current = vault_root

        for part in relative_path.parts:
            current = current / part
            folder_claude = current / "CLAUDE.md"

            if folder_claude.is_file():
                content = folder_claude.read_text(encoding="utf-8")
                context_parts.append(
                    f"# Folder Context: {current.relative_to(vault_root)}\n\n{content}"
                )

    except ValueError:
        # cwd not relative to vault_root
        pass

    return "\n\n---\n\n".join(context_parts) if context_parts else ""


if __name__ == "__main__":
    # CLI usage: print vault context
    context = get_vault_context()

    if context:
        print(context)
        sys.exit(0)
    else:
        print("No vault context available", file=sys.stderr)
        sys.exit(1)
