"""Vault intelligence: parse CLAUDE.md files and note frontmatter."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

import yaml
from loguru import logger


@dataclass
class VaultContext:
    """Parsed vault context from CLAUDE.md files."""

    root_instructions: str
    folder_instructions: dict[str, str]  # folder path -> instructions
    note_types: list[str]
    vault_path: Path


@dataclass
class NoteFrontmatter:
    """Parsed note frontmatter."""

    note_type: str | None = None
    status: str | None = None
    tags: list[str] | None = None
    related: list[str] | None = None
    sources: list[str] | None = None
    created: str | None = None
    updated: str | None = None
    raw: dict | None = None


class VaultParser:
    """Parse vault CLAUDE.md files and note frontmatter."""

    def __init__(self, vault_path: Path | str):
        self.vault_path = Path(vault_path)
        if not self.vault_path.exists():
            raise ValueError(f"Vault path does not exist: {vault_path}")

        self._context_cache: VaultContext | None = None

    def get_vault_context(self) -> VaultContext:
        """Parse and cache vault context from CLAUDE.md files."""
        if self._context_cache:
            return self._context_cache

        root_claude_md = self.vault_path / "CLAUDE.md"
        root_instructions = ""
        if root_claude_md.exists():
            root_instructions = root_claude_md.read_text(encoding="utf-8")

        folder_instructions: dict[str, str] = {}
        for claude_file in self.vault_path.rglob("CLAUDE.md"):
            if claude_file == root_claude_md:
                continue
            relative_folder = claude_file.parent.relative_to(self.vault_path)
            folder_instructions[str(relative_folder)] = claude_file.read_text(encoding="utf-8")

        # Extract note types from root instructions
        note_types = self._extract_note_types(root_instructions)

        self._context_cache = VaultContext(
            root_instructions=root_instructions,
            folder_instructions=folder_instructions,
            note_types=note_types,
            vault_path=self.vault_path,
        )

        return self._context_cache

    def _extract_note_types(self, instructions: str) -> list[str]:
        """Extract note types from CLAUDE.md content."""
        # Common note types based on vault structure
        default_types = [
            "fleeting",
            "literature",
            "permanent",
            "daily",
            "project",
            "technical",
            "reference",
        ]

        # Try to find explicit type definitions in the text
        found_types = set(default_types)

        # Look for type: [fleeting|literature|permanent...] patterns
        type_pattern = r"type:\s*\[([^\]]+)\]"
        matches = re.findall(type_pattern, instructions)
        for match in matches:
            types = [t.strip() for t in match.split("|")]
            found_types.update(types)

        return sorted(found_types)

    def parse_frontmatter(self, note_content: str) -> NoteFrontmatter:
        """Parse YAML frontmatter from note content."""
        # Extract frontmatter between --- markers
        frontmatter_pattern = r"^---\s*\n(.*?)\n---"
        match = re.match(frontmatter_pattern, note_content, re.DOTALL)

        if not match:
            return NoteFrontmatter()

        try:
            frontmatter_yaml = match.group(1)
            data = yaml.safe_load(frontmatter_yaml)

            if not isinstance(data, dict):
                return NoteFrontmatter()

            return NoteFrontmatter(
                note_type=data.get("type"),
                status=data.get("status"),
                tags=data.get("tags"),
                related=data.get("related"),
                sources=data.get("sources"),
                created=data.get("created"),
                updated=data.get("updated"),
                raw=data,
            )
        except yaml.YAMLError as e:
            logger.warning(f"Failed to parse frontmatter: {e}")
            return NoteFrontmatter()

    def get_note_type_instructions(self, note_type: str | None) -> str:
        """Get specific instructions for a note type."""
        if not note_type:
            return ""

        context = self.get_vault_context()

        # Look for note type instructions in root CLAUDE.md
        instructions = context.root_instructions

        # Extract section for this note type
        # Look for patterns like "### Permanent Notes" or "## Permanent Note"
        pattern = rf"###?\s+{re.escape(note_type.title())}.*?\n(.*?)(?=\n##|\Z)"
        match = re.search(pattern, instructions, re.DOTALL | re.IGNORECASE)

        if match:
            return match.group(0).strip()

        return f"Create a {note_type} note following vault conventions."

    def get_folder_instructions(self, note_path: Path | str) -> str:
        """Get folder-specific CLAUDE.md instructions for a note."""
        note_path = Path(note_path)

        # Make relative to vault if needed
        try:
            if note_path.is_absolute():
                rel_path = note_path.relative_to(self.vault_path)
            else:
                rel_path = note_path
        except ValueError:
            return ""

        context = self.get_vault_context()

        # Check each parent folder for CLAUDE.md
        current = rel_path.parent
        while current != Path("."):
            folder_key = str(current)
            if folder_key in context.folder_instructions:
                return context.folder_instructions[folder_key]
            current = current.parent

        return ""

    def build_full_context(
        self,
        note_path: Path | str | None = None,
        note_content: str | None = None,
    ) -> str:
        """Build complete vault context for prompt injection."""
        context = self.get_vault_context()

        parts = [
            "# Vault Context",
            "",
            "You are working in an Obsidian vault with specific conventions.",
            "",
        ]

        # Add root instructions (summary)
        if context.root_instructions:
            # Extract just the core philosophy and note types section
            root_summary = self._extract_summary(context.root_instructions)
            parts.append("## Vault Conventions")
            parts.append(root_summary)
            parts.append("")

        # Add folder-specific instructions if note path provided
        if note_path:
            folder_inst = self.get_folder_instructions(note_path)
            if folder_inst:
                parts.append("## Folder-Specific Instructions")
                parts.append(folder_inst)
                parts.append("")

        # Add note type instructions if note content provided
        if note_content:
            frontmatter = self.parse_frontmatter(note_content)
            if frontmatter.note_type:
                type_inst = self.get_note_type_instructions(frontmatter.note_type)
                if type_inst:
                    parts.append(f"## {frontmatter.note_type.title()} Note Guidelines")
                    parts.append(type_inst)
                    parts.append("")

        return "\n".join(parts)

    def _extract_summary(self, instructions: str, max_lines: int = 50) -> str:
        """Extract a summary of instructions (first N lines or sections)."""
        lines = instructions.split("\n")

        # Take first max_lines or until a major section break
        summary_lines = []
        for i, line in enumerate(lines):
            if i >= max_lines:
                break
            if i > 20 and line.startswith("## ") and "example" in line.lower():
                # Stop before example sections
                break
            summary_lines.append(line)

        return "\n".join(summary_lines).strip()
