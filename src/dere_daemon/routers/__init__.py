"""FastAPI routers for dere-daemon endpoints."""

from dere_daemon.agent import agent_router

from .activity import router as activity_router
from .ambient import router as ambient_router
from .context import router as context_router
from .dashboard import router as dashboard_router
from .emotions import router as emotions_router
from .core_memory import router as core_memory_router
from .knowledge_graph import router as kg_router
from .missions import router as missions_router
from .notifications import router as notifications_router
from .presence import router as presence_router
from .recall import router as recall_router
from .sessions import router as sessions_router
from .swarm import router as swarm_router
from .taskwarrior import router as taskwarrior_router
from .work_queue import router as work_queue_router

__all__ = [
    "agent_router",
    "activity_router",
    "ambient_router",
    "context_router",
    "dashboard_router",
    "emotions_router",
    "core_memory_router",
    "kg_router",
    "missions_router",
    "notifications_router",
    "presence_router",
    "recall_router",
    "sessions_router",
    "swarm_router",
    "taskwarrior_router",
    "work_queue_router",
]
