"""Prompt template loader for Jinja2-based prompts."""

from __future__ import annotations

from pathlib import Path

from jinja2 import Environment, FileSystemLoader, TemplateNotFound
from loguru import logger


class PromptTemplateLoader:
    """Loads and renders Jinja2 prompt templates."""

    def __init__(self, prompts_dir: Path | str | None = None):
        if prompts_dir is None:
            # Default to prompts directory next to this file
            prompts_dir = Path(__file__).parent / "prompts"

        self.prompts_dir = Path(prompts_dir)
        self.env = Environment(
            loader=FileSystemLoader(str(self.prompts_dir)),
            autoescape=False,  # Don't escape markdown
            trim_blocks=True,
            lstrip_blocks=True,
        )

        logger.debug(f"Initialized PromptTemplateLoader with directory: {self.prompts_dir}")

    def list_available(self) -> list[str]:
        """List all available prompt templates."""
        if not self.prompts_dir.exists():
            logger.warning(f"Prompts directory does not exist: {self.prompts_dir}")
            return []

        # Get all .md and .j2 files, return without extension
        templates = []
        for file in self.prompts_dir.glob("*.md"):
            templates.append(file.stem)
        for file in self.prompts_dir.glob("*.j2"):
            if file.stem not in templates:  # Avoid duplicates
                templates.append(file.stem)

        return sorted(templates)

    def render(self, template_name: str, **variables) -> str:
        """Render a prompt template with the given variables.

        Args:
            template_name: Name of the template (without extension)
            **variables: Variables to pass to the template

        Returns:
            Rendered prompt text

        Raises:
            TemplateNotFound: If template doesn't exist
        """
        # Try .md first, then .j2
        template_files = [f"{template_name}.md", f"{template_name}.j2"]

        for template_file in template_files:
            try:
                template = self.env.get_template(template_file)
                rendered = template.render(**variables)
                logger.debug(f"Rendered template: {template_name}")
                return rendered
            except TemplateNotFound:
                continue

        # If we get here, template wasn't found
        raise TemplateNotFound(f"Template '{template_name}' not found in {self.prompts_dir}")
