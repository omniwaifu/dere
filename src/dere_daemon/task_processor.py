from __future__ import annotations

import asyncio
import json
import time
from typing import Any, cast

from loguru import logger

from dere_daemon.database import Database
from dere_daemon.ollama_client import OllamaClient, get_entity_extraction_schema
from dere_shared.models import (
    ContextBuildingMetadata,
    EmbeddingMetadata,
    EntityExtractionMetadata,
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

    def __init__(self, db: Database, ollama: OllamaClient):
        self.db = db
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
        tasks_by_model = self.db.get_tasks_by_model()

        if not tasks_by_model:
            return

        logger.debug("Found tasks: {}", tasks_by_model)

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
        self.db.update_task_status(task.id, TaskStatus.PROCESSING)

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
                    self.db.update_task_status(
                        task.id, TaskStatus.FAILED, f"Unknown task type: {task.task_type}"
                    )
                    return

            if result and result.get("success"):
                logger.info("✓ Task {} completed: {}", task.id, task.task_type)
                self.db.update_task_status(task.id, TaskStatus.COMPLETED)
            else:
                error = result.get("error", "Unknown error") if result else "No result"
                logger.error("Task {} failed: {}", task.id, error)
                self._handle_task_error(task, error)

        except Exception as e:
            logger.error("Task {} failed with exception: {}", task.id, e)
            self._handle_task_error(task, str(e))

    def _handle_task_error(self, task: TaskQueue, error: str) -> None:
        """Handle task error with retry logic"""
        retry_count = task.retry_count or 0

        if retry_count < self.max_retries:
            logger.info("Task {} retry {}/{}", task.id, retry_count + 1, self.max_retries)
            self.db.increment_task_retry(task.id)
            self.db.update_task_status(task.id, TaskStatus.PENDING)
        else:
            logger.error("✗ Task {} failed after {} retries: {}", task.id, self.max_retries, error)
            self.db.update_task_status(task.id, TaskStatus.FAILED, error)

    async def process_embedding_task(self, task: TaskQueue) -> dict[str, Any]:
        """Process an embedding generation task"""
        try:
            metadata = cast(EmbeddingMetadata, task.metadata or {})

            # Generate embedding
            embedding = await self.ollama.get_embedding(task.content)

            # Store embedding if for a conversation
            conversation_id = metadata.get("conversation_id")
            if conversation_id:
                self.db.update_conversation_embedding(conversation_id, embedding)
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
            metadata = cast(SummarizationMetadata, task.metadata or {})
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

            # Generate summary
            summary = await self.ollama.generate(prompt, model=task.model_name)

            # Store summary
            session_id = task.session_id
            if session_id:
                self.db.store_session_summary(
                    session_id,
                    "exit",
                    summary.strip(),
                    model_used=task.model_name,
                )
                logger.info("Stored summary for session {}", session_id)

            return {"success": True, "summary": summary.strip()}

        except Exception as e:
            return {"success": False, "error": str(e)}

    async def process_entity_extraction_task(self, task: TaskQueue) -> dict[str, Any]:
        """Process an entity extraction task"""
        try:
            metadata = cast(EntityExtractionMetadata, task.metadata or {})
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

            # Generate with schema
            schema = get_entity_extraction_schema()
            result = await self.ollama.generate(prompt, model=task.model_name, schema=schema)

            # Parse result
            entities_data = json.loads(result)
            entities = entities_data.get("entities", [])

            # Store entities
            if task.session_id:
                conversation_id = metadata.get("conversation_id")
                for entity in entities:
                    self.db.store_entity(
                        task.session_id,
                        conversation_id,
                        entity.get("type", "unknown"),
                        entity.get("value", ""),
                        entity.get("normalized_value", entity.get("value", "").lower()),
                        entity.get("confidence", 0.5),
                    )
                logger.info("Stored {} entities for session {}", len(entities), task.session_id)

            return {"success": True, "entities": entities}

        except Exception as e:
            return {"success": False, "error": str(e)}

    async def process_context_building_task(self, task: TaskQueue) -> dict[str, Any]:
        """Process a context building task with hybrid entity+embedding search"""
        try:
            metadata = cast(ContextBuildingMetadata, task.metadata or {})
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
            if entity_values:
                results = self.db.search_with_entities_and_embeddings(
                    entity_values, embedding, limit=context_depth * 2, entity_weight=0.6
                )
            else:
                results = self.db.search_similar(embedding, limit=context_depth, threshold=0.7)

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
                cache_meta = {
                    "sources": len(context_parts),
                    "tokens": total_tokens,
                    "used_entities": bool(entity_values),
                    "entity_count": len(entity_values),
                    "cross_session_count": len(seen_sessions),
                }
                self.db.store_context_cache(session_id, context, cache_meta)
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
            metadata = cast(dict, task.metadata or {})
            user_id = metadata.get("user_id")
            recency_days = metadata.get("recency_days", 30)

            if not user_id:
                return {"success": False, "error": "user_id required for memory consolidation"}

            # 1. Get entity importance scores
            important_entities = self.db.get_entity_importance_scores(
                user_id, limit=20, recency_days=recency_days
            )

            # 2. Get entity collision candidates
            collisions = self.db.find_entity_collisions(tuple())

            # 3. Build statistical summary
            stats = {
                "important_entities": important_entities[:10],
                "entity_collisions": len(collisions),
                "total_entities": len(important_entities),
            }

            # 4. Use LLM to generate natural language summary
            entities_summary = [
                e["normalized_value"] + " (" + e["entity_type"] + ")"
                for e in important_entities[:10]
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

            summary = await self.ollama.generate(prompt, model=task.model_name)

            # 5. Store insight in database
            self.db.store_insight(
                insight_type="memory_consolidation",
                content=summary,
                evidence=stats,
                confidence=0.8,
                personality_combo=tuple(),
                user_session_id=None,
            )

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
