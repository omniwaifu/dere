"""Context composition utilities for personality and emotional state."""

from __future__ import annotations

from typing import TYPE_CHECKING

from dere_shared.personalities import PersonalityLoader

if TYPE_CHECKING:
    from dere_daemon.database import Database


async def compose_session_context(
    session_id: int | None,
    db: Database,
    personality_loader: PersonalityLoader,
    medium: str | None = None,
    include_emotion: bool = True,
    current_message: str | None = None,
) -> tuple[str, int | None]:
    """Compose context from session personality and emotional state.

    Args:
        session_id: Optional session ID to use. If None, finds latest active session.
        db: Database instance
        personality_loader: PersonalityLoader instance
        medium: Optional medium filter ("cli", "discord", or None for any)
        include_emotion: Whether to include emotional state summary
        current_message: Optional current message for document context injection

    Returns:
        Tuple of (context_string, resolved_session_id)
        Returns ("", None) if no session or personality found.
    """
    # Resolve session if not provided
    if not session_id:
        session = db.get_latest_active_session(medium=medium)
        if not session:
            return "", None
        session_id = session["id"]

    # Resolve personality using hierarchy: session > user_session > default
    personality_name = db.resolve_personality_hierarchy(session_id, default_personality=None)

    if not personality_name:
        return "", session_id

    context_parts = []

    # Add document context if active documents and current message provided
    if current_message:
        try:
            doc_context = await _build_document_context(session_id, current_message, db)
            if doc_context:
                context_parts.append(doc_context)
        except Exception:
            # Document context unavailable, skip
            pass

    # Add personality prompt
    try:
        personality = personality_loader.load(personality_name)
        context_parts.append(personality.prompt_content)
    except ValueError:
        # Personality not found, skip
        pass

    # Add emotional state if requested
    if include_emotion and context_parts:
        try:
            from dere_daemon.main import get_or_create_emotion_manager

            emotion_manager = await get_or_create_emotion_manager(session_id, personality_name)
            emotion_summary = emotion_manager.get_summary()

            if emotion_summary and emotion_summary.strip():
                context_parts.append(f"Current emotional state: {emotion_summary}")
        except Exception:
            # Emotion system unavailable, skip
            pass

    return "\n\n".join(context_parts), session_id


async def _build_document_context(
    session_id: int, current_message: str, db: Database
) -> str | None:
    """Build document context from active documents.

    Args:
        session_id: Session ID
        current_message: Current message for relevance search
        db: Database instance

    Returns:
        Formatted document context string or None
    """
    # Get active documents for this session
    active_doc_ids = db.get_active_documents(session_id)
    if not active_doc_ids:
        return None

    # Generate embedding for current message
    try:
        from dere_daemon.main import app
        from dere_shared.documents import DocumentEmbedder

        embedder = DocumentEmbedder(app.state.ollama)
        query_embedding = await embedder.embed_query(current_message)
    except Exception:
        return None

    # Search chunks from active documents only
    try:
        all_results = db.search_document_chunks(
            embedding=query_embedding, user_id=None, limit=10, threshold=0.5
        )

        # Filter to only active documents
        relevant_chunks = [r for r in all_results if r.get("document_id") in active_doc_ids][:3]

        if not relevant_chunks:
            return None

        # Format document context
        context_lines = ["=== DOCUMENT CONTEXT ==="]
        for chunk in relevant_chunks:
            filename = chunk.get("filename", "unknown")
            content = chunk.get("content", "")[:500]  # Limit chunk size
            similarity = chunk.get("similarity", 0)
            context_lines.append(f"\n[{filename}] (relevance: {similarity:.2f})")
            context_lines.append(content)

        context_lines.append("\n=== END DOCUMENT CONTEXT ===")
        return "\n".join(context_lines)

    except Exception:
        return None
