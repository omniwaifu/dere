from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


# OCC Emotion Taxonomy following Steunebrink, Dastani, & Meyer revision
class OCCEmotionType(str, Enum):
    """
    Taxonomy of emotions according to OCC (Ortony, Clore, Collins),
    reflecting the revised hierarchical structure.
    """

    # --- BRANCH 1: Event Consequences (Pleased/Displeased) ---
    # 1a. Prospective Consequences
    HOPE = "hope"
    FEAR = "fear"

    # 1b. Actual Consequences (for self)
    JOY = "joy"
    DISTRESS = "distress"

    # Specializations based on Prospect Confirmation/Disconfirmation
    SATISFACTION = "satisfaction"  # Joy confirming Hope
    RELIEF = "relief"  # Joy disconfirming Fear
    FEARS_CONFIRMED = "fears-confirmed"  # Distress confirming Fear
    DISAPPOINTMENT = "disappointment"  # Distress disconfirming Hope

    # 1c. Actual Consequences (for others - Fortune-of-Others)
    HAPPY_FOR = "happy-for"  # Joy about event desirable for another
    PITY = "pity"  # Distress about event undesirable for another
    GLOATING = "gloating"  # Joy about event undesirable for another
    RESENTMENT = "resentment"  # Distress about event desirable for another

    # --- BRANCH 2: Agent Actions (Approving/Disapproving) ---
    # 2a. Actions by Self
    PRIDE = "pride"
    SHAME = "shame"

    # 2b. Actions by Other
    ADMIRATION = "admiration"
    REPROACH = "reproach"

    # --- BRANCH 3: Object Aspects (Liking/Disliking) ---
    # 3a. Familiar Objects
    LOVE = "love"
    HATE = "hate"

    # 3b. Unfamiliar Objects
    INTEREST = "interest"
    DISGUST = "disgust"

    # --- COMPOUND EMOTIONS (Combining Branches) ---
    GRATITUDE = "gratitude"  # Admiration + Joy
    ANGER = "anger"  # Reproach + Distress
    GRATIFICATION = "gratification"  # Pride + Joy
    REMORSE = "remorse"  # Shame + Distress

    # --- UTILITY ---
    NEUTRAL = "neutral"


type AppraisalDimension = Literal["event", "action", "object"]


@dataclass
class EmotionHierarchyInfo:
    """Metadata about an emotion's position in the OCC hierarchy"""

    dimension: AppraisalDimension | Literal["compound", "utility"]
    parents: list[OCCEmotionType] = Field(default_factory=list)


# OCC Hierarchy structure
OCC_HIERARCHY: dict[OCCEmotionType, EmotionHierarchyInfo] = {
    # Branch 1: Event Consequences
    OCCEmotionType.HOPE: EmotionHierarchyInfo(dimension="event", parents=[]),
    OCCEmotionType.FEAR: EmotionHierarchyInfo(dimension="event", parents=[]),
    OCCEmotionType.JOY: EmotionHierarchyInfo(dimension="event", parents=[]),
    OCCEmotionType.DISTRESS: EmotionHierarchyInfo(dimension="event", parents=[]),
    OCCEmotionType.SATISFACTION: EmotionHierarchyInfo(
        dimension="event", parents=[OCCEmotionType.JOY]
    ),
    OCCEmotionType.RELIEF: EmotionHierarchyInfo(dimension="event", parents=[OCCEmotionType.JOY]),
    OCCEmotionType.FEARS_CONFIRMED: EmotionHierarchyInfo(
        dimension="event", parents=[OCCEmotionType.DISTRESS]
    ),
    OCCEmotionType.DISAPPOINTMENT: EmotionHierarchyInfo(
        dimension="event", parents=[OCCEmotionType.DISTRESS]
    ),
    OCCEmotionType.HAPPY_FOR: EmotionHierarchyInfo(dimension="event", parents=[OCCEmotionType.JOY]),
    OCCEmotionType.PITY: EmotionHierarchyInfo(dimension="event", parents=[OCCEmotionType.DISTRESS]),
    OCCEmotionType.GLOATING: EmotionHierarchyInfo(dimension="event", parents=[OCCEmotionType.JOY]),
    OCCEmotionType.RESENTMENT: EmotionHierarchyInfo(
        dimension="event", parents=[OCCEmotionType.DISTRESS]
    ),
    # Branch 2: Agent Actions
    OCCEmotionType.PRIDE: EmotionHierarchyInfo(dimension="action", parents=[]),
    OCCEmotionType.SHAME: EmotionHierarchyInfo(dimension="action", parents=[]),
    OCCEmotionType.ADMIRATION: EmotionHierarchyInfo(dimension="action", parents=[]),
    OCCEmotionType.REPROACH: EmotionHierarchyInfo(dimension="action", parents=[]),
    # Branch 3: Object Aspects
    OCCEmotionType.LOVE: EmotionHierarchyInfo(dimension="object", parents=[]),
    OCCEmotionType.HATE: EmotionHierarchyInfo(dimension="object", parents=[]),
    OCCEmotionType.INTEREST: EmotionHierarchyInfo(dimension="object", parents=[]),
    OCCEmotionType.DISGUST: EmotionHierarchyInfo(dimension="object", parents=[]),
    # Compound Emotions
    OCCEmotionType.GRATITUDE: EmotionHierarchyInfo(
        dimension="compound", parents=[OCCEmotionType.ADMIRATION, OCCEmotionType.JOY]
    ),
    OCCEmotionType.ANGER: EmotionHierarchyInfo(
        dimension="compound", parents=[OCCEmotionType.REPROACH, OCCEmotionType.DISTRESS]
    ),
    OCCEmotionType.GRATIFICATION: EmotionHierarchyInfo(
        dimension="compound", parents=[OCCEmotionType.PRIDE, OCCEmotionType.JOY]
    ),
    OCCEmotionType.REMORSE: EmotionHierarchyInfo(
        dimension="compound", parents=[OCCEmotionType.SHAME, OCCEmotionType.DISTRESS]
    ),
    # Utility
    OCCEmotionType.NEUTRAL: EmotionHierarchyInfo(dimension="utility", parents=[]),
}


def get_appraisal_dimensions(emotion_type: OCCEmotionType) -> list[AppraisalDimension]:
    """Get the primary appraisal dimension(s) for an emotion type"""
    info = OCC_HIERARCHY.get(emotion_type)
    if not info:
        return []

    if info.dimension == "compound" and info.parents:
        dimensions: set[AppraisalDimension] = set()
        for parent_type in info.parents:
            for dim in get_appraisal_dimensions(parent_type):
                dimensions.add(dim)
        return list(dimensions)
    elif info.dimension in ("event", "action", "object"):
        return [info.dimension]  # type: ignore
    else:
        return []


@dataclass(frozen=True)
class EmotionCharacteristics:
    """Psychological characteristics that affect emotion dynamics"""

    valence: Literal["positive", "negative", "neutral"]
    arousal: Literal["high", "medium", "low"]
    persistence: Literal["sticky", "normal", "fleeting"]
    social_relevance: Literal["high", "medium", "low"]
    action_tendency: Literal["approach", "avoid", "freeze", "neutral"]


# Emotion characteristics mapping (from psychology research)
EMOTION_CHARACTERISTICS: dict[OCCEmotionType, EmotionCharacteristics] = {
    # Positive emotions
    OCCEmotionType.JOY: EmotionCharacteristics("positive", "high", "normal", "medium", "approach"),
    OCCEmotionType.HOPE: EmotionCharacteristics("positive", "medium", "sticky", "low", "approach"),
    OCCEmotionType.SATISFACTION: EmotionCharacteristics(
        "positive", "medium", "normal", "low", "approach"
    ),
    OCCEmotionType.RELIEF: EmotionCharacteristics("positive", "low", "fleeting", "low", "neutral"),
    OCCEmotionType.HAPPY_FOR: EmotionCharacteristics(
        "positive", "medium", "normal", "high", "approach"
    ),
    OCCEmotionType.PRIDE: EmotionCharacteristics(
        "positive", "medium", "sticky", "medium", "approach"
    ),
    OCCEmotionType.ADMIRATION: EmotionCharacteristics(
        "positive", "low", "normal", "high", "approach"
    ),
    OCCEmotionType.LOVE: EmotionCharacteristics("positive", "medium", "sticky", "high", "approach"),
    OCCEmotionType.GRATITUDE: EmotionCharacteristics(
        "positive", "medium", "sticky", "high", "approach"
    ),
    OCCEmotionType.GRATIFICATION: EmotionCharacteristics(
        "positive", "high", "normal", "low", "approach"
    ),
    OCCEmotionType.INTEREST: EmotionCharacteristics(
        "positive", "medium", "normal", "low", "approach"
    ),
    # Negative emotions
    OCCEmotionType.DISTRESS: EmotionCharacteristics(
        "negative", "high", "sticky", "medium", "avoid"
    ),
    OCCEmotionType.FEAR: EmotionCharacteristics("negative", "high", "sticky", "low", "freeze"),
    OCCEmotionType.DISAPPOINTMENT: EmotionCharacteristics(
        "negative", "medium", "normal", "low", "avoid"
    ),
    OCCEmotionType.FEARS_CONFIRMED: EmotionCharacteristics(
        "negative", "high", "sticky", "low", "freeze"
    ),
    OCCEmotionType.PITY: EmotionCharacteristics("negative", "low", "normal", "high", "approach"),
    OCCEmotionType.GLOATING: EmotionCharacteristics(
        "negative", "medium", "fleeting", "high", "approach"
    ),
    OCCEmotionType.RESENTMENT: EmotionCharacteristics(
        "negative", "medium", "sticky", "high", "avoid"
    ),
    OCCEmotionType.SHAME: EmotionCharacteristics("negative", "medium", "sticky", "high", "avoid"),
    OCCEmotionType.REPROACH: EmotionCharacteristics(
        "negative", "medium", "normal", "high", "avoid"
    ),
    OCCEmotionType.HATE: EmotionCharacteristics("negative", "high", "sticky", "high", "avoid"),
    OCCEmotionType.ANGER: EmotionCharacteristics("negative", "high", "normal", "high", "approach"),
    OCCEmotionType.REMORSE: EmotionCharacteristics(
        "negative", "medium", "sticky", "medium", "avoid"
    ),
    OCCEmotionType.DISGUST: EmotionCharacteristics("negative", "medium", "normal", "low", "avoid"),
    # Neutral
    OCCEmotionType.NEUTRAL: EmotionCharacteristics("neutral", "low", "normal", "low", "neutral"),
}


# OCC Components for appraisal
class OCCGoal(BaseModel):
    """Goal in the OCC model (used for event appraisal)"""

    id: str
    description: str
    active: bool
    importance: int = Field(ge=0, le=10)


class OCCStandard(BaseModel):
    """Standard in the OCC model (used for action appraisal)"""

    id: str
    description: str
    importance: int = Field(ge=0, le=10)
    praiseworthiness: int = Field(ge=-10, le=10)


class OCCAttitude(BaseModel):
    """Attitude in the OCC model (used for object appraisal)"""

    id: str
    target_object: str
    description: str
    appealingness: int = Field(ge=-10, le=10)


# Emotion state models
class OCCEmotion(BaseModel):
    """A specific emotion instance"""

    type: OCCEmotionType
    intensity: float = Field(ge=0, le=100)
    name: str
    eliciting: str


class EmotionInstance(BaseModel):
    """Internal emotion instance with timestamp"""

    type: OCCEmotionType
    intensity: float = Field(ge=0, le=100)
    last_updated: int  # Unix timestamp ms


class OCCAppraisal(BaseModel):
    """OCC appraisal components"""

    event_outcome: EventOutcome | None = None
    agent_action: AgentAction | None = None
    object_attribute: ObjectAttribute | None = None


class EventOutcome(BaseModel):
    """Event consequence appraisal"""

    type: Literal["desirable", "undesirable", "neutral"] | None = None
    prospect: Literal["prospective", "actual", "none"] | None = None
    affected_goals: list[str] = []
    desirability: float = Field(default=0, ge=-10, le=10)


class AgentAction(BaseModel):
    """Agent action appraisal"""

    agent: Literal["self", "other"] | None = None
    type: Literal["praiseworthy", "blameworthy", "neutral"] | None = None
    affected_standards: list[str] = []
    praiseworthiness: float = Field(default=0, ge=-10, le=10)


class ObjectAttribute(BaseModel):
    """Object aspect appraisal"""

    familiarity: Literal["familiar", "unfamiliar", "none"] | None = None
    type: Literal["appealing", "unappealing", "neutral"] | None = None
    affected_attitudes: list[str] = []
    appealingness: float = Field(default=0, ge=-10, le=10)


class EmotionSchemaOutput(BaseModel):
    """Single emotion output from LLM"""

    type: OCCEmotionType = Field(description="OCC emotion type")
    intensity: float = Field(ge=0, le=100, description="Intensity 0-100")
    eliciting: str = Field(description="Why this emotion arose")


class AppraisalOutput(BaseModel):
    """Complete appraisal output from LLM"""

    event_outcome: EventOutcome | None = None
    agent_action: AgentAction | None = None
    object_attribute: ObjectAttribute | None = None
    resulting_emotions: list[EmotionSchemaOutput] = Field(min_length=1)
    reasoning: str | None = None


class OCCEmotionState(BaseModel):
    """Overall emotional state at a point in time"""

    primary: OCCEmotion
    secondary: OCCEmotion | None = None
    intensity: float
    last_update: str  # ISO timestamp
    appraisal: OCCAppraisal
    trigger: dict | str | None = None


class CurrentMoodState(BaseModel):
    """Simplified current mood for external use"""

    dominant_emotion_type: OCCEmotionType
    intensity: float
    last_updated: int | None = None
