from __future__ import annotations

import asyncio
import json
import time
from typing import Any, cast

from loguru import logger
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from dere_daemon.ollama_client import OllamaClient, get_entity_extraction_schema
from dere_shared.models import (
    ContextBuildingMetadata,
    Conversation,
    EmbeddingMetadata,
    Entity,
    EntityExtractionMetadata,
    Session,
    SummarizationMetadata,
    TaskQueue,
    TaskStatus,
)


def format_relative_time(timestamp: int) -> str:
    """Format timestamp as relative time string

    Args:
        timestamp: Unix timestamp in seconds

    Returns:
        Human-readable relative time (e.g., "2h ago", "3 days ago")
    """
    age_seconds = int(time.time()) - timestamp

    if age_seconds < 3600:  # Less than 1 hour
        minutes = age_seconds // 60
        return f"{minutes}m ago" if minutes > 0 else "just now"
    elif age_seconds < 86400:  # Less than 1 day
        hours = age_seconds // 3600
        return f"{hours}h ago"
    elif age_seconds < 604800:  # Less than 1 week
        days = age_seconds // 86400
        return f"{days}d ago"
    else:  # 1 week or more
        weeks = age_seconds // 604800
        return f"{weeks}w ago"


class TaskProcessor:
    """Background task processor for embeddings, summarization, entity extraction"""

    def __init__(self, session_factory: async_sessionmaker[AsyncSession], ollama: OllamaClient):
        self.session_factory = session_factory
        self.ollama = ollama
        self.max_retries = 3
        self.current_model: str | None = None
        self._running = False
        self._task: asyncio.Task | None = None
        self._trigger_event = asyncio.Event()

    async def start(self) -> None:
        """Start background processing loop"""
        self._running = True
        self._task = asyncio.create_task(self._process_loop())
        logger.info("Task processor started")

    async def shutdown(self) -> None:
        """Stop background processing"""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("Task processor stopped")

    def trigger(self) -> None:
        """Trigger immediate task processing"""
        self._trigger_event.set()

    async def _process_loop(self) -> None:
        """Main processing loop"""
        while self._running:
            try:
                await self.process_tasks()
            except Exception as e:
                logger.error("Error in task processing loop: {}", e)

            # Wait for trigger or timeout
            try:
                await asyncio.wait_for(self._trigger_event.wait(), timeout=5.0)
                self._trigger_event.clear()
            except TimeoutError:
                pass

    async def process_tasks(self) -> None:
        """Process pending tasks grouped by model"""
        async with self.session_factory() as session:
            # Get pending tasks grouped by model
            stmt = (
                select(TaskQueue)
                .where(TaskQueue.status == TaskStatus.PENDING)
                .order_by(TaskQueue.priority.desc(), TaskQueue.created_at.asc())
            )
            result = await session.execute(stmt)
            all_tasks = result.scalars().all()

            if not all_tasks:
                return

            # Group tasks by model
            tasks_by_model: dict[str, list[TaskQueue]] = {}
            for task in all_tasks:
                model = task.model_name or "default"
                if model not in tasks_by_model:
                    tasks_by_model[model] = []
                tasks_by_model[model].append(task)

        if not tasks_by_model:
            return

        logger.debug("Found tasks: {}", {k: len(v) for k, v in tasks_by_model.items()})

        for model_name, tasks in tasks_by_model.items():
            if not tasks:
                continue

            logger.info("Processing {} tasks for model {}", len(tasks), model_name)

            # Switch model if needed
            if self.current_model != model_name:
                logger.info("Switching to model: {}", model_name)
                self.current_model = model_name
                await asyncio.sleep(0.5)

            # Process all tasks for this model
            for task in tasks:
                await self._process_task(task)

    async def _process_task(self, task: TaskQueue) -> None:
        """Process a single task"""
        # Mark as processing
        async with self.session_factory() as session:
            stmt = (
                update(TaskQueue)
                .where(TaskQueue.id == task.id)
                .values(status=TaskStatus.PROCESSING)
            )
            await session.execute(stmt)
            await session.commit()

        logger.info("Task {} starting: {}", task.id, task.task_type)

        try:
            match task.task_type:
                case "embedding":
                    result = await self.process_embedding_task(task)
                case "summarization":
                    result = await self.process_summarization_task(task)
                case "entity_extraction":
                    result = await self.process_entity_extraction_task(task)
                case "context_building":
                    result = await self.process_context_building_task(task)
                case "memory_consolidation":
                    result = await self.process_memory_consolidation_task(task)
                case _:
                    logger.error("Unknown task type: {}", task.task_type)
                    async with self.session_factory() as session:
                        stmt = (
                            update(TaskQueue)
                            .where(TaskQueue.id == task.id)
                            .values(
                                status=TaskStatus.FAILED,
                                error_message=f"Unknown task type: {task.task_type}",
                            )
                        )
                        await session.execute(stmt)
                        await session.commit()
                    return

            if result and result.get("success"):
                logger.info("✓ Task {} completed: {}", task.id, task.task_type)
                async with self.session_factory() as session:
                    stmt = (
                        update(TaskQueue)
                        .where(TaskQueue.id == task.id)
                        .values(status=TaskStatus.COMPLETED)
                    )
                    await session.execute(stmt)
                    await session.commit()
            else:
                error = result.get("error", "Unknown error") if result else "No result"
                logger.error("Task {} failed: {}", task.id, error)
                await self._handle_task_error(task, error)

        except Exception as e:
            logger.error("Task {} failed with exception: {}", task.id, e)
            await self._handle_task_error(task, str(e))

    async def _handle_task_error(self, task: TaskQueue, error: str) -> None:
        """Handle task error with retry logic"""
        retry_count = task.retry_count or 0

        if retry_count < self.max_retries:
            logger.info("Task {} retry {}/{}", task.id, retry_count + 1, self.max_retries)
            async with self.session_factory() as session:
                stmt = (
                    update(TaskQueue)
                    .where(TaskQueue.id == task.id)
                    .values(
                        retry_count=retry_count + 1,
                        status=TaskStatus.PENDING,
                    )
                )
                await session.execute(stmt)
                await session.commit()
        else:
            logger.error("✗ Task {} failed after {} retries: {}", task.id, self.max_retries, error)
            async with self.session_factory() as session:
                stmt = (
                    update(TaskQueue)
                    .where(TaskQueue.id == task.id)
                    .values(
                        status=TaskStatus.FAILED,
                        error_message=error,
                    )
                )
                await session.execute(stmt)
                await session.commit()

    async def process_embedding_task(self, task: TaskQueue) -> dict[str, Any]:
        """Process an embedding generation task"""
        try:
            metadata = cast(EmbeddingMetadata, task.task_metadata or {})

            # Log content size before embedding
            content_length = len(task.content)
            logger.info(
                "Processing embedding task: {} chars (~{} tokens)",
                content_length,
                content_length // 4,  # Rough token estimate
            )

            # Generate embedding
            embedding = await self.ollama.get_embedding(task.content)

            # Store embedding if for a conversation
            conversation_id = metadata.get("conversation_id")
            if conversation_id:
                async with self.session_factory() as session:
                    stmt = (
                        update(Conversation)
                        .where(Conversation.id == conversation_id)
                        .values(prompt_embedding=embedding)
                    )
                    await session.execute(stmt)
                    await session.commit()
                logger.info("Stored embedding for conversation {}", conversation_id)

            return {
                "success": True,
                "embedding": embedding,
                "processed_text": task.content,
                "processing_mode": metadata.get("processing_mode", "raw"),
            }

        except Exception as e:
            return {"success": False, "error": str(e)}

    async def process_summarization_task(self, task: TaskQueue) -> dict[str, Any]:
        """Process a summarization task"""
        try:
            metadata = cast(SummarizationMetadata, task.task_metadata or {})
            personality = metadata.get("personality", "")
            max_length = metadata.get("max_length", 200)

            # Build summarization prompt
            prompt = f"""Summarize the following conversation in {max_length} words or less.
Focus on key topics, decisions made, and action items.
Do not use numbered lists, bullet points, or structured formatting. Write in plain paragraphs only.

Conversation:
{task.content}

Summary:"""

            if personality:
                prompt = f"{personality}\n\n{prompt}"

            # Log content size before generation
            prompt_length = len(prompt)
            logger.info(
                "Processing summarization task: {} chars (~{} tokens)",
                prompt_length,
                prompt_length // 4,  # Rough token estimate
            )

            # Generate summary
            summary = await self.ollama.generate(prompt, model=task.model_name)

            # Store summary
            session_id = task.session_id
            if session_id:
                async with self.session_factory() as session:
                    stmt = (
                        update(Session)
                        .where(Session.id == session_id)
                        .values(
                            summary=summary.strip(),
                            summarization_model=task.model_name,
                        )
                    )
                    await session.execute(stmt)
                    await session.commit()
                logger.info("Stored summary for session {}", session_id)

            return {"success": True, "summary": summary.strip()}

        except Exception as e:
            return {"success": False, "error": str(e)}

    async def process_entity_extraction_task(self, task: TaskQueue) -> dict[str, Any]:
        """Process an entity extraction task"""
        try:
            metadata = cast(EntityExtractionMetadata, task.task_metadata or {})
            context_hint = metadata.get("context_hint", "coding")

            # Build entity extraction prompt
            context_prompt = ""
            if context_hint == "coding":
                context_prompt = "This is a software development conversation. Focus on extracting code entities like functions, files, libraries, and technical concepts."
            else:
                context_prompt = "Extract meaningful entities from this text."

            prompt = f"""{context_prompt}

Extract key entities from this text. Return JSON with entities array.

Format:
{{"entities": [{{"type": "technology", "value": "React", "normalized_value": "react", "confidence": 0.9}}]}}

Text: {task.content}

JSON:"""

            # Log content size before generation
            prompt_length = len(prompt)
            logger.info(
                "Processing entity extraction task: {} chars (~{} tokens)",
                prompt_length,
                prompt_length // 4,  # Rough token estimate
            )

            # Generate with schema
            schema = get_entity_extraction_schema()
            result = await self.ollama.generate(prompt, model=task.model_name, schema=schema)

            # Parse result
            entities_data = json.loads(result)
            entities = entities_data.get("entities", [])

            # Store entities
            if task.session_id:
                conversation_id = metadata.get("conversation_id")
                async with self.session_factory() as session:
                    for entity in entities:
                        entity_obj = Entity(
                            session_id=task.session_id,
                            conversation_id=conversation_id,
                            entity_type=entity.get("type", "unknown"),
                            value=entity.get("value", ""),
                            normalized_value=entity.get(
                                "normalized_value", entity.get("value", "").lower()
                            ),
                            confidence=entity.get("confidence", 0.5),
                            timestamp=int(time.time()),
                        )
                        session.add(entity_obj)
                    await session.commit()
                logger.info("Stored {} entities for session {}", len(entities), task.session_id)

            return {"success": True, "entities": entities}

        except Exception as e:
            return {"success": False, "error": str(e)}

    async def process_context_building_task(self, task: TaskQueue) -> dict[str, Any]:
        """Process a context building task with hybrid entity+embedding search"""
        try:
            metadata = cast(ContextBuildingMetadata, task.task_metadata or {})
            session_id = metadata.get("session_id")
            context_depth = metadata.get("context_depth", 5)
            max_tokens = metadata.get("max_tokens", 2000)
            include_entities = metadata.get("include_entities", False)

            # Generate embedding for current prompt
            embedding = await self.ollama.get_embedding(task.content)

            # Extract entities from prompt for hybrid search
            entity_values: list[str] = []
            if include_entities:
                try:
                    schema = get_entity_extraction_schema()
                    entity_prompt = f"""Extract key entities from this text. Focus on technical terms, names, and concepts.

Text: {task.content}

JSON:"""
                    prompt_length = len(entity_prompt)
                    logger.debug(
                        "Pattern entity extraction: {} chars (~{} tokens)",
                        prompt_length,
                        prompt_length // 4,
                    )
                    result = await self.ollama.generate(
                        entity_prompt, model="gemma3n:latest", schema=schema
                    )
                    entities_data = json.loads(result)
                    entity_values = [
                        e.get("normalized_value", e.get("value", "").lower())
                        for e in entities_data.get("entities", [])
                        if e.get("confidence", 0) > 0.6
                    ]
                    logger.debug("Extracted {} entities for context building", len(entity_values))
                except Exception as e:
                    logger.warning("Entity extraction failed for context building: {}", e)

            # Perform hybrid search if entities found, otherwise use pure embedding search
            async with self.session_factory() as db:
                from sqlalchemy import func, literal

                if entity_values:
                    # Hybrid search with entities + embeddings
                    # Build entity_matches CTE
                    entity_matches_cte = (
                        select(
                            Conversation.id.label("conv_id"),
                            func.count(func.distinct(Entity.id))
                            .cast(literal(0.0).type)
                            .label("entity_score"),
                        )
                        .select_from(Conversation)
                        .join(Entity, Entity.conversation_id == Conversation.id)
                        .where(Entity.normalized_value.in_(entity_values))
                        .group_by(Conversation.id)
                        .cte("entity_matches")
                    )

                    # Build semantic_matches CTE
                    semantic_matches_cte = (
                        select(
                            Conversation.id.label("conv_id"),
                            (1 - (Conversation.prompt_embedding.cosine_distance(embedding))).label(
                                "semantic_score"
                            ),
                        )
                        .where(Conversation.prompt_embedding.is_not(None))
                        .cte("semantic_matches")
                    )

                    # Calculate max entity count for normalization
                    max_entity_count = (
                        select(func.max(entity_matches_cte.c.entity_score))
                        .select_from(entity_matches_cte)
                        .scalar_subquery()
                    )

                    entity_weight = 0.6
                    semantic_weight = 0.4

                    # Final query
                    stmt = (
                        select(
                            Conversation.id,
                            Conversation.prompt,
                            Conversation.timestamp,
                            Session.working_dir,
                            func.coalesce(entity_matches_cte.c.entity_score, 0).label(
                                "entity_score"
                            ),
                            func.coalesce(semantic_matches_cte.c.semantic_score, 0).label(
                                "semantic_score"
                            ),
                            (
                                func.coalesce(entity_matches_cte.c.entity_score, 0)
                                / func.coalesce(max_entity_count, 1)
                                * entity_weight
                                + func.coalesce(semantic_matches_cte.c.semantic_score, 0)
                                * semantic_weight
                            ).label("combined_score"),
                        )
                        .select_from(Conversation)
                        .join(Session, Session.id == Conversation.session_id)
                        .outerjoin(
                            entity_matches_cte,
                            entity_matches_cte.c.conv_id == Conversation.id,
                        )
                        .outerjoin(
                            semantic_matches_cte,
                            semantic_matches_cte.c.conv_id == Conversation.id,
                        )
                        .order_by(literal("combined_score").desc())
                        .limit(context_depth * 2)
                    )

                    result = await db.execute(stmt)
                    rows = result.all()
                    results = [
                        {
                            "id": row.id,
                            "prompt": row.prompt,
                            "timestamp": row.timestamp,
                            "working_dir": row.working_dir,
                            "matched_entities": [],  # TODO: extract matched entities
                        }
                        for row in rows
                    ]
                else:
                    # Pure vector similarity search
                    stmt = (
                        select(
                            Conversation.id,
                            Conversation.prompt,
                            Conversation.timestamp,
                            Session.working_dir,
                            (1 - (Conversation.prompt_embedding.cosine_distance(embedding))).label(
                                "similarity"
                            ),
                        )
                        .join(Session, Session.id == Conversation.session_id)
                        .where(Conversation.prompt_embedding.is_not(None))
                        .where(
                            (1 - (Conversation.prompt_embedding.cosine_distance(embedding))) >= 0.7
                        )
                        .order_by(Conversation.prompt_embedding.cosine_distance(embedding))
                        .limit(context_depth)
                    )

                    result = await db.execute(stmt)
                    rows = result.all()
                    results = [
                        {
                            "id": row.id,
                            "prompt": row.prompt,
                            "timestamp": row.timestamp,
                            "working_dir": row.working_dir,
                            "matched_entities": [],
                        }
                        for row in rows
                    ]

            # Group results by recency tiers
            recent = []  # < 24h
            this_week = []  # 24h - 7 days
            earlier = []  # > 7 days

            current_time = int(time.time())
            for conv in results:
                age = current_time - conv.get("timestamp", current_time)
                if age < 86400:
                    recent.append(conv)
                elif age < 604800:
                    this_week.append(conv)
                else:
                    earlier.append(conv)

            # Build context with temporal sections
            context_parts = []
            total_tokens = 0
            seen_sessions = set()

            def add_tier_context(tier_name: str, conversations: list[dict]) -> None:
                nonlocal total_tokens
                if not conversations:
                    return

                tier_parts = []
                for conv in conversations:
                    tokens = len(conv["prompt"]) // 4
                    if total_tokens + tokens > max_tokens:
                        break

                    working_dir = conv.get("working_dir", "")
                    medium = "Discord" if "discord://" in working_dir else "CLI"
                    seen_sessions.add(working_dir)

                    timestamp = conv.get("timestamp", current_time)
                    time_ago = format_relative_time(timestamp)

                    matched = conv.get("matched_entities", [])
                    if matched and include_entities:
                        entities_str = ", ".join(matched[:3])
                        tier_parts.append(
                            f"[{time_ago}, {medium}] Related: {entities_str}\n{conv['prompt']}"
                        )
                    else:
                        tier_parts.append(f"[{time_ago}, {medium}]\n{conv['prompt']}")

                    total_tokens += tokens

                if tier_parts:
                    context_parts.append(f"[{tier_name}]\n" + "\n\n".join(tier_parts))

            # Add tiers in order
            add_tier_context("Recent (last 24h)", recent)
            add_tier_context("This week", this_week)
            add_tier_context("Earlier", earlier)

            context = "\n\n---\n\n".join(context_parts)

            # Cache context with metadata
            if session_id:
                from dere_shared.models import ContextCache

                cache_meta = {
                    "sources": len(context_parts),
                    "tokens": total_tokens,
                    "used_entities": bool(entity_values),
                    "entity_count": len(entity_values),
                    "cross_session_count": len(seen_sessions),
                }
                async with self.session_factory() as db:
                    cache = ContextCache(
                        session_id=session_id,
                        context_data=context,
                        context_metadata=cache_meta,
                        created_at=int(time.time()),
                    )
                    db.add(cache)
                    await db.commit()
                logger.info(
                    "Cached context for session {} ({} sources)", session_id, len(context_parts)
                )

            return {
                "success": True,
                "context": context,
                "sources": len(context_parts),
                "entities_used": entity_values,
            }

        except Exception as e:
            return {"success": False, "error": str(e)}

    async def process_memory_consolidation_task(self, task: TaskQueue) -> dict[str, Any]:
        """Process a memory consolidation task.

        Computes:
        1. Entity importance scores (mention count + recency + cross-medium)
        2. Conversation frequency patterns
        3. Entity co-occurrence patterns
        4. Uses LLM to generate natural language summary from statistics
        """
        try:
            metadata = cast(dict, task.task_metadata or {})
            user_id = metadata.get("user_id")
            recency_days = metadata.get("recency_days", 30)

            if not user_id:
                return {"success": False, "error": "user_id required for memory consolidation"}

            # 1. Get entity importance scores
            async with self.session_factory() as db:
                from sqlalchemy import distinct, func

                cutoff_time = int(time.time()) - (recency_days * 86400)

                stmt = (
                    select(
                        Entity.normalized_value,
                        Entity.entity_type,
                        func.count(Entity.id).label("mention_count"),
                        func.count(distinct(Conversation.medium)).label("medium_count"),
                        func.max(Entity.timestamp).label("last_seen"),
                    )
                    .join(Session, Session.id == Entity.session_id)
                    .join(Conversation, Conversation.id == Entity.conversation_id)
                    .where(Session.user_id == user_id)
                    .where(Entity.timestamp >= cutoff_time)
                    .group_by(Entity.normalized_value, Entity.entity_type)
                    .order_by(
                        func.count(Entity.id).desc(),
                        func.max(Entity.timestamp).desc(),
                    )
                    .limit(20)
                )

                result = await db.execute(stmt)
                rows = result.all()

                important_entities = [
                    {
                        "normalized_value": row.normalized_value,
                        "entity_type": row.entity_type,
                        "mention_count": row.mention_count,
                        "medium_count": row.medium_count,
                        "last_seen": row.last_seen,
                    }
                    for row in rows
                ]

            # 2. Get entity collision candidates (entities with very similar normalized values)
            async with self.session_factory() as db:
                # Find entities that might be duplicates based on normalized value similarity
                # For now, just count entities with same normalized_value but different values
                stmt = (
                    select(
                        Entity.normalized_value,
                        func.count(distinct(Entity.value)).label("variant_count"),
                    )
                    .join(Session, Session.id == Entity.session_id)
                    .where(Session.user_id == user_id)
                    .group_by(Entity.normalized_value)
                    .having(func.count(distinct(Entity.value)) > 1)
                )

                result = await db.execute(stmt)
                collision_rows = result.all()
                collisions = [
                    {
                        "normalized_value": row.normalized_value,
                        "variant_count": row.variant_count,
                    }
                    for row in collision_rows
                ]

            # 3. Build statistical summary
            stats = {
                "important_entities": important_entities[:10],
                "entity_collisions": len(collisions),
                "total_entities": len(important_entities),
            }

            # 4. Use LLM to generate natural language summary
            entities_summary = [
                f"{e['normalized_value']} ({e['entity_type']})" for e in important_entities[:10]
            ]
            prompt = f"""Analyze this user's conversation patterns and generate a concise memory consolidation summary.

Statistics:
- Top 10 Important Entities: {json.dumps(entities_summary)}
- Entity Collision Groups: {len(collisions)} (entities with similar fingerprints that may be duplicates)
- Total Tracked Entities: {len(important_entities)}

Generate a brief summary (2-3 sentences) highlighting:
1. The most important topics/entities for this user
2. Any cross-medium patterns (entities appearing in both CLI and Discord)
3. Actionable insights or recommendations

Summary:"""

            # Log content size before generation
            prompt_length = len(prompt)
            logger.info(
                "Processing insight generation task: {} chars (~{} tokens)",
                prompt_length,
                prompt_length // 4,
            )

            summary = await self.ollama.generate(prompt, model=task.model_name)

            # 5. Store insight in database
            async with self.session_factory() as db:
                from dere_shared.models import ConversationInsight

                insight = ConversationInsight(
                    insight_type="memory_consolidation",
                    content=summary,
                    evidence=stats,
                    confidence=0.8,
                    personality_combo="",  # Empty for user-level insights
                    user_session_id=None,
                    created_at=int(time.time()),
                )
                db.add(insight)
                await db.commit()

            logger.info(
                "Memory consolidation completed for user {} with {} entities",
                user_id,
                len(important_entities),
            )

            return {
                "success": True,
                "summary": summary,
                "stats": stats,
            }

        except Exception as e:
            logger.error("Memory consolidation failed: {}", e)
            return {"success": False, "error": str(e)}
