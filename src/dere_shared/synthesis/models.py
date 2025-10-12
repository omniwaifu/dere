"""Pydantic models for synthesis outputs."""

from __future__ import annotations

from pydantic import BaseModel, Field


class ConversationInsight(BaseModel):
    """A synthesized insight from conversation patterns."""

    insight_type: str = Field(
        ..., description="Type of insight (convergence, temporal, emotion, etc.)"
    )
    content: str = Field(..., description="Natural language insight")
    evidence: dict = Field(default_factory=dict, description="Supporting evidence data")
    confidence: float = Field(default=0.5, ge=0.0, le=1.0, description="Confidence score")
    personality_combo: tuple[str, ...] = Field(
        default=(), description="Personality combination this applies to"
    )


class ConversationPattern(BaseModel):
    """A detected pattern across conversations."""

    pattern_type: str = Field(..., description="Type of pattern (co-occurrence, temporal, etc.)")
    description: str = Field(..., description="Pattern description")
    frequency: int = Field(default=1, description="How often this pattern appears")
    sessions: list[int] = Field(
        default_factory=list, description="Session IDs where pattern appears"
    )
    personality_combo: tuple[str, ...] = Field(default=(), description="Personality combination")


class SynthesisResult(BaseModel):
    """Results from a synthesis run."""

    total_sessions: int = Field(default=0)
    personality_combo: tuple[str, ...] = Field(default=())
    insights: list[ConversationInsight] = Field(default_factory=list)
    patterns: list[ConversationPattern] = Field(default_factory=list)
    entity_collisions: list[list[str]] = Field(
        default_factory=list, description="Entity name variations"
    )
