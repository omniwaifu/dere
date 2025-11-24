"""Emotion system endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Request
from loguru import logger

router = APIRouter(prefix="/emotion", tags=["emotions"])


@router.get("/state/{session_id}")
async def emotion_get_state(session_id: int, request: Request):
    """Get current emotional state for a session"""
    from dere_daemon.main import get_or_create_emotion_manager

    try:
        emotion_manager = await get_or_create_emotion_manager(session_id)
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
        # FIXME(sweep:stack): FastAPI - Tuple return won't set status code; use raise HTTPException(status_code=500, detail=str(e))
        return {"error": str(e)}, 500


@router.get("/summary/{session_id}")
async def emotion_get_summary(session_id: int, request: Request):
    """Get human-readable emotion summary for prompt injection"""
    from dere_daemon.main import get_or_create_emotion_manager

    try:
        emotion_manager = await get_or_create_emotion_manager(session_id)
        summary = emotion_manager.get_emotional_state_summary()

        return {"summary": summary}
    except Exception as e:
        logger.error(f"[emotion_get_summary] Error: {e}")
        return {"summary": "Currently in a neutral emotional state."}
