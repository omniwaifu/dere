"""Emotion system endpoints."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter
from loguru import logger
from pydantic import BaseModel

router = APIRouter(prefix="/emotion", tags=["emotions"])


class ResultingEmotion(BaseModel):
    """An emotion that resulted from appraisal."""

    type: str
    intensity: float


class EmotionEvent(BaseModel):
    """A stimulus event that affected emotional state."""

    timestamp: int
    stimulus_type: str
    valence: float
    intensity: float
    resulting_emotions: list[ResultingEmotion] = []
    reasoning: str | None = None


class EmotionHistoryResponse(BaseModel):
    """Response containing emotion history."""

    events: list[EmotionEvent]
    total_count: int


class EmotionHistoryDBResponse(BaseModel):
    """Response containing emotion history from database with time range."""

    events: list[EmotionEvent]
    total_count: int
    start_time: int
    end_time: int


class OCCGoalResponse(BaseModel):
    """OCC Goal display model."""

    id: str
    description: str
    importance: int
    active: bool = True


class OCCStandardResponse(BaseModel):
    """OCC Standard display model."""

    id: str
    description: str
    importance: int


class OCCAttitudeResponse(BaseModel):
    """OCC Attitude display model."""

    id: str
    target_object: str
    description: str
    appealingness: int


class EmotionProfileResponse(BaseModel):
    """User's OCC psychological profile."""

    has_profile: bool
    profile_path: str | None = None
    goals: list[OCCGoalResponse] = []
    standards: list[OCCStandardResponse] = []
    attitudes: list[OCCAttitudeResponse] = []


@router.get("/state")
async def emotion_get_state():
    """Get current global emotional state."""
    from dere_daemon.main import get_global_emotion_manager

    try:
        emotion_manager = await get_global_emotion_manager()
        mood = emotion_manager.get_current_mood()

        if not mood:
            return {"has_emotion": False, "state": "neutral"}

        return {
            "has_emotion": True,
            "dominant_emotion": mood.dominant_emotion_type,
            "intensity": mood.intensity,
            "last_updated": mood.last_updated,
            "active_emotions": {
                str(k): {"intensity": v.intensity, "last_updated": v.last_updated}
                for k, v in emotion_manager.get_active_emotions().items()
            },
        }
    except Exception as e:
        logger.error(f"[emotion_get_state] Error: {e}")
        return {"has_emotion": False, "state": "neutral", "error": str(e)}


@router.get("/summary")
async def emotion_get_summary():
    """Get human-readable emotion summary for prompt injection."""
    from dere_daemon.main import get_global_emotion_manager

    try:
        emotion_manager = await get_global_emotion_manager()
        summary = emotion_manager.get_emotional_state_summary()

        return {"summary": summary}
    except Exception as e:
        logger.error(f"[emotion_get_summary] Error: {e}")
        return {"summary": "Currently in a neutral emotional state."}


@router.get("/history", response_model=EmotionHistoryResponse)
async def emotion_get_history(limit: int = 100):
    """Get emotion stimulus history from in-memory buffer (last hour)."""
    from dere_daemon.main import get_global_emotion_manager

    try:
        emotion_manager = await get_global_emotion_manager()

        # Get all stimuli from the buffer (last hour by default)
        recent_stimuli = emotion_manager.stimulus_buffer.get_recent_stimuli(
            60 * 60 * 1000  # Last hour
        )

        events = []
        for stimulus in recent_stimuli[-limit:]:
            ctx = stimulus.context or {}
            events.append(
                EmotionEvent(
                    timestamp=stimulus.timestamp,
                    stimulus_type=stimulus.type,
                    valence=stimulus.valence,
                    intensity=stimulus.intensity,
                    resulting_emotions=[
                        ResultingEmotion(**e) for e in ctx.get("resulting_emotions", [])
                    ],
                    reasoning=ctx.get("reasoning"),
                )
            )

        return EmotionHistoryResponse(
            events=list(reversed(events)),  # Most recent first
            total_count=len(recent_stimuli),
        )
    except Exception as e:
        logger.error(f"[emotion_get_history] Error: {e}")
        return EmotionHistoryResponse(events=[], total_count=0)


@router.get("/history/db", response_model=EmotionHistoryDBResponse)
async def emotion_get_history_db(
    start_time: int | None = None,
    end_time: int | None = None,
    limit: int = 500,
):
    """Get emotion stimulus history from database with time range.

    Args:
        start_time: Start timestamp in ms (default: 24 hours ago)
        end_time: End timestamp in ms (default: now)
        limit: Max events to return (default: 500)
    """
    import time

    from dere_daemon.main import app

    now_ms = int(time.time() * 1000)
    if end_time is None:
        end_time = now_ms
    if start_time is None:
        start_time = now_ms - (24 * 60 * 60 * 1000)  # 24 hours ago

    try:
        # Query DB directly for global emotion history (session_id=0 -> NULL)
        history = await app.state.db.load_stimulus_history(0, start_time)

        # Filter by end_time and limit
        filtered = [h for h in history if h["timestamp"] <= end_time][:limit]

        events = []
        for h in filtered:
            ctx = h.get("context") or {}
            events.append(
                EmotionEvent(
                    timestamp=h["timestamp"],
                    stimulus_type=h["type"],
                    valence=h["valence"],
                    intensity=h["intensity"],
                    resulting_emotions=[
                        ResultingEmotion(**e) for e in ctx.get("resulting_emotions", [])
                    ],
                    reasoning=ctx.get("reasoning"),
                )
            )

        return EmotionHistoryDBResponse(
            events=events,
            total_count=len(filtered),
            start_time=start_time,
            end_time=end_time,
        )
    except Exception as e:
        logger.error(f"[emotion_get_history_db] Error: {e}")
        return EmotionHistoryDBResponse(
            events=[],
            total_count=0,
            start_time=start_time,
            end_time=end_time,
        )


@router.get("/profile", response_model=EmotionProfileResponse)
async def emotion_get_profile():
    """Get user's OCC psychological profile."""
    user_occ_path = Path.home() / ".config" / "dere" / "user_occ.json"

    if not user_occ_path.exists():
        # Return the default profile that was loaded into the emotion manager
        try:
            from dere_daemon.main import get_global_emotion_manager

            emotion_manager = await get_global_emotion_manager()
            engine = emotion_manager.appraisal_engine

            return EmotionProfileResponse(
                has_profile=False,
                profile_path=str(user_occ_path),
                goals=[
                    OCCGoalResponse(
                        id=g.id,
                        description=g.description,
                        importance=g.importance,
                        active=g.active,
                    )
                    for g in engine.goals
                ],
                standards=[
                    OCCStandardResponse(
                        id=s.id,
                        description=s.description,
                        importance=s.importance,
                    )
                    for s in engine.standards
                ],
                attitudes=[
                    OCCAttitudeResponse(
                        id=a.id,
                        target_object=a.target_object,
                        description=a.description,
                        appealingness=a.appealingness,
                    )
                    for a in engine.attitudes
                ],
            )
        except Exception as e:
            logger.error(f"[emotion_get_profile] Error getting defaults: {e}")
            return EmotionProfileResponse(
                has_profile=False,
                profile_path=str(user_occ_path),
            )

    try:
        with open(user_occ_path) as f:
            user_occ = json.load(f)

        return EmotionProfileResponse(
            has_profile=True,
            profile_path=str(user_occ_path),
            goals=[OCCGoalResponse(**g) for g in user_occ.get("goals", [])],
            standards=[OCCStandardResponse(**s) for s in user_occ.get("standards", [])],
            attitudes=[OCCAttitudeResponse(**a) for a in user_occ.get("attitudes", [])],
        )
    except Exception as e:
        logger.error(f"[emotion_get_profile] Error loading profile: {e}")
        return EmotionProfileResponse(
            has_profile=False,
            profile_path=str(user_occ_path),
        )
