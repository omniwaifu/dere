"""Persona loading utilities for dere-discord."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass

from dere_shared.personalities import PersonalityLoader

from .paths import get_config_dir


@dataclass(slots=True)
class PersonaProfile:
    """Persona metadata for downstream consumers."""

    names: tuple[str, ...]
    prompt: str
    color: str | None
    icon: str | None


class PersonaService:
    """Resolve personality combinations into prompts and metadata."""

    def __init__(self, default_personas: tuple[str, ...]):
        self._default_personas = default_personas
        self._loader = PersonalityLoader(get_config_dir())
        self._identity: str | None = None

    @property
    def default_personas(self) -> tuple[str, ...]:
        return self._default_personas

    def set_identity(self, identity: str | None) -> None:
        self._identity = identity

    def resolve(self, personas: Iterable[str] | None = None) -> PersonaProfile:
        """Resolve persona tuple into prompt + display metadata."""

        names = tuple(personas) if personas else self._default_personas
        prompts: list[str] = []
        color: str | None = None
        icon: str | None = None

        for idx, name in enumerate(names):
            personality = self._loader.load(name)
            if idx == 0:
                color = personality.color
                icon = personality.icon
            prompts.append(personality.prompt_content)

        prompt_text = "\n\n".join(prompts)
        if self._identity:
            prompt_text = (
                f"You are {self._identity}. Unless asked otherwise, introduce yourself "
                "using this name.\n\n"
            ) + prompt_text
        return PersonaProfile(names=names, prompt=prompt_text, color=color, icon=icon)
