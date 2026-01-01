from __future__ import annotations

from typing import TypeAlias

from pydantic import BaseModel

from dere_shared.emotion.models import AppraisalOutput
from dere_shared.models import AmbientEngagementDecision, AmbientMissionDecision


class ExplorationOutput(BaseModel):
    findings: list[str] = []
    confidence: float = 0.0
    follow_up_questions: list[str] = []
    worth_sharing: bool = False
    share_message: str | None = None


class ScheduleParseResult(BaseModel):
    cron: str
    timezone: str = "UTC"
    explanation: str | None = None


class SessionTitleResult(BaseModel):
    title: str


LLMSchemaRegistry: TypeAlias = dict[str, type[BaseModel]]

LLM_SCHEMA_REGISTRY: LLMSchemaRegistry = {
    "AppraisalOutput": AppraisalOutput,
    "AmbientEngagementDecision": AmbientEngagementDecision,
    "AmbientMissionDecision": AmbientMissionDecision,
    "ExplorationOutput": ExplorationOutput,
    "ScheduleParseResult": ScheduleParseResult,
    "SessionTitleResult": SessionTitleResult,
}

__all__ = [
    "AppraisalOutput",
    "AmbientEngagementDecision",
    "AmbientMissionDecision",
    "ExplorationOutput",
    "ScheduleParseResult",
    "SessionTitleResult",
    "LLM_SCHEMA_REGISTRY",
]
