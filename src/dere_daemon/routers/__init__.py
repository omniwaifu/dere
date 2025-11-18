"""FastAPI routers for dere-daemon endpoints."""

from .context import router as context_router
from .emotions import router as emotions_router
from .knowledge_graph import router as kg_router
from .notifications import router as notifications_router
from .presence import router as presence_router
from .sessions import router as sessions_router

__all__ = [
    "sessions_router",
    "emotions_router",
    "notifications_router",
    "presence_router",
    "kg_router",
    "context_router",
]
