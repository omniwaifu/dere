"""UI preferences API for managing user/assistant UI settings."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from loguru import logger
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from dere_daemon.dependencies import get_db
from dere_shared.models import UIPreferences, UIPreferenceSetBy

router = APIRouter(prefix="/ui-preferences", tags=["ui-preferences"])


class UIPreferencesResponse(BaseModel):
    """Current UI preferences."""

    theme: str
    custom_accent_hue: int | None
    right_panel_state: str
    left_panel_state: str
    hidden_widgets: list[str]
    set_by: str
    last_rearranged_at: str | None
    last_change_reason: str | None


class UpdateUIPreferencesRequest(BaseModel):
    """Request to update UI preferences."""

    theme: str | None = None
    custom_accent_hue: int | None = None
    right_panel_state: Literal["expanded", "collapsed", "hidden"] | None = None
    left_panel_state: Literal["expanded", "collapsed", "hidden"] | None = None
    hidden_widgets: list[str] | None = None
    # These are set automatically based on caller
    # set_by: handled by endpoint
    # reason: only for assistant changes


class AssistantUIChangeRequest(BaseModel):
    """Request for assistant to change UI preferences."""

    preference: str  # Which preference to change
    value: str  # New value
    reason: str  # Why she's making this change


async def get_or_create_preferences(
    session: AsyncSession, user_id: str = "default"
) -> UIPreferences:
    """Get existing preferences or create defaults."""
    stmt = select(UIPreferences).where(UIPreferences.user_id == user_id)
    result = await session.execute(stmt)
    prefs = result.scalar_one_or_none()

    if prefs is None:
        prefs = UIPreferences(user_id=user_id)
        session.add(prefs)
        await session.commit()
        await session.refresh(prefs)
        logger.info(f"[ui_preferences] Created default preferences for user {user_id}")

    return prefs


@router.get("", response_model=UIPreferencesResponse)
async def get_preferences(
    user_id: str = "default",
    session: AsyncSession = Depends(get_db),
) -> UIPreferencesResponse:
    """Get current UI preferences for a user."""
    prefs = await get_or_create_preferences(session, user_id)

    return UIPreferencesResponse(
        theme=prefs.theme,
        custom_accent_hue=prefs.custom_accent_hue,
        right_panel_state=prefs.right_panel_state,
        left_panel_state=prefs.left_panel_state,
        hidden_widgets=prefs.hidden_widgets or [],
        set_by=prefs.set_by,
        last_rearranged_at=prefs.last_rearranged_at.isoformat() if prefs.last_rearranged_at else None,
        last_change_reason=prefs.last_change_reason,
    )


@router.patch("", response_model=UIPreferencesResponse)
async def update_preferences(
    request: UpdateUIPreferencesRequest,
    user_id: str = "default",
    session: AsyncSession = Depends(get_db),
) -> UIPreferencesResponse:
    """Update UI preferences (user-initiated)."""
    prefs = await get_or_create_preferences(session, user_id)

    if request.theme is not None:
        prefs.theme = request.theme
    if request.custom_accent_hue is not None:
        prefs.custom_accent_hue = request.custom_accent_hue
    if request.right_panel_state is not None:
        prefs.right_panel_state = request.right_panel_state
    if request.left_panel_state is not None:
        prefs.left_panel_state = request.left_panel_state
    if request.hidden_widgets is not None:
        prefs.hidden_widgets = request.hidden_widgets

    prefs.set_by = UIPreferenceSetBy.USER.value
    prefs.updated_at = datetime.now(UTC)

    await session.commit()
    await session.refresh(prefs)

    logger.info(f"[ui_preferences] User updated preferences: {request}")

    return UIPreferencesResponse(
        theme=prefs.theme,
        custom_accent_hue=prefs.custom_accent_hue,
        right_panel_state=prefs.right_panel_state,
        left_panel_state=prefs.left_panel_state,
        hidden_widgets=prefs.hidden_widgets or [],
        set_by=prefs.set_by,
        last_rearranged_at=prefs.last_rearranged_at.isoformat() if prefs.last_rearranged_at else None,
        last_change_reason=prefs.last_change_reason,
    )


@router.post("/assistant-change", response_model=UIPreferencesResponse)
async def assistant_change_preference(
    request: AssistantUIChangeRequest,
    user_id: str = "default",
    session: AsyncSession = Depends(get_db),
) -> UIPreferencesResponse:
    """Allow assistant to change a UI preference.

    This is called by the agent tool when she wants to rearrange the UI.
    """
    prefs = await get_or_create_preferences(session, user_id)

    valid_preferences = {
        "theme": ["default", "cozy", "minimal", "vibrant"],
        "right_panel_state": ["expanded", "collapsed", "hidden"],
        "left_panel_state": ["expanded", "collapsed", "hidden"],
        "custom_accent_hue": None,  # Any int 0-360 or "auto"
    }

    if request.preference not in valid_preferences:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid preference '{request.preference}'. Valid: {list(valid_preferences.keys())}",
        )

    # Validate value
    if request.preference == "custom_accent_hue":
        if request.value == "auto":
            prefs.custom_accent_hue = None
        else:
            try:
                hue = int(request.value)
                if not 0 <= hue <= 360:
                    raise ValueError("Hue must be 0-360")
                prefs.custom_accent_hue = hue
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e)) from e
    else:
        valid_values = valid_preferences[request.preference]
        if valid_values and request.value not in valid_values:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid value '{request.value}' for {request.preference}. Valid: {valid_values}",
            )
        setattr(prefs, request.preference, request.value)

    prefs.set_by = UIPreferenceSetBy.ASSISTANT.value
    prefs.last_rearranged_at = datetime.now(UTC)
    prefs.last_change_reason = request.reason
    prefs.updated_at = datetime.now(UTC)

    await session.commit()
    await session.refresh(prefs)

    logger.info(
        f"[ui_preferences] Assistant changed {request.preference} to {request.value}: {request.reason}"
    )

    return UIPreferencesResponse(
        theme=prefs.theme,
        custom_accent_hue=prefs.custom_accent_hue,
        right_panel_state=prefs.right_panel_state,
        left_panel_state=prefs.left_panel_state,
        hidden_widgets=prefs.hidden_widgets or [],
        set_by=prefs.set_by,
        last_rearranged_at=prefs.last_rearranged_at.isoformat() if prefs.last_rearranged_at else None,
        last_change_reason=prefs.last_change_reason,
    )
