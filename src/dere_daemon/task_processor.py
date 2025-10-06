from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, cast

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

logger = logging.getLogger(__name__)


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
                logger.error(f"Error in task processing loop: {e}")

            # Wait for trigger or timeout
            try:
                await asyncio.wait_for(self._trigger_event.wait(), timeout=5.0)
                self._trigger_event.clear()
            except asyncio.TimeoutError:
                pass

    async def process_tasks(self) -> None:
        """Process pending tasks grouped by model"""
        tasks_by_model = self.db.get_tasks_by_model()

        if not tasks_by_model:
            print(f"DEBUG: No tasks found in queue")
            return

        print(f"DEBUG: Found tasks: {tasks_by_model}")

        for model_name, tasks in tasks_by_model.items():
            if not tasks:
                continue

            logger.info(f"Processing {len(tasks)} tasks for model {model_name}")

            # Switch model if needed
            if self.current_model != model_name:
                logger.info(f"Switching to model: {model_name}")
                self.current_model = model_name
                await asyncio.sleep(0.5)

            # Process all tasks for this model
            for task in tasks:
                await self._process_task(task)

    async def _process_task(self, task: TaskQueue) -> None:
        """Process a single task"""
        # Mark as processing
        self.db.update_task_status(task.id, TaskStatus.PROCESSING)

        logger.info(f"Task {task.id} starting: {task.task_type}")

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
                case _:
                    logger.error(f"Unknown task type: {task.task_type}")
                    self.db.update_task_status(
                        task.id, TaskStatus.FAILED, f"Unknown task type: {task.task_type}"
                    )
                    return

            if result and result.get("success"):
                logger.info(f"✓ Task {task.id} completed: {task.task_type}")
                self.db.update_task_status(task.id, TaskStatus.COMPLETED)
            else:
                error = result.get("error", "Unknown error") if result else "No result"
                logger.error(f"Task {task.id} failed: {error}")
                self._handle_task_error(task, error)

        except Exception as e:
            logger.error(f"Task {task.id} failed with exception: {e}")
            self._handle_task_error(task, str(e))

    def _handle_task_error(self, task: TaskQueue, error: str) -> None:
        """Handle task error with retry logic"""
        retry_count = task.retry_count or 0

        if retry_count < self.max_retries:
            logger.info(f"Task {task.id} retry {retry_count + 1}/{self.max_retries}")
            self.db.increment_task_retry(task.id)
            self.db.update_task_status(task.id, TaskStatus.PENDING)
        else:
            logger.error(f"✗ Task {task.id} failed after {self.max_retries} retries: {error}")
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
                logger.info(f"Stored embedding for conversation {conversation_id}")

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
                logger.info(f"Stored summary for session {session_id}")

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
                logger.info(f"Stored {len(entities)} entities for session {task.session_id}")

            return {"success": True, "entities": entities}

        except Exception as e:
            return {"success": False, "error": str(e)}

    async def process_context_building_task(self, task: TaskQueue) -> dict[str, Any]:
        """Process a context building task"""
        try:
            metadata = cast(ContextBuildingMetadata, task.metadata or {})
            session_id = metadata.get("session_id")
            context_depth = metadata.get("context_depth", 5)
            max_tokens = metadata.get("max_tokens", 2000)

            # Generate embedding for current prompt
            embedding = await self.ollama.get_embedding(task.content)

            # Search for similar conversations
            similar = self.db.search_similar(embedding, limit=context_depth, threshold=0.7)

            # Build context from similar conversations
            context_parts = []
            total_tokens = 0

            for conv in similar:
                tokens = len(conv["prompt"]) // 4
                if total_tokens + tokens > max_tokens:
                    break

                context_parts.append(f"Related past conversation:\n{conv['prompt']}")
                total_tokens += tokens

            context = "\n\n---\n\n".join(context_parts)

            # Cache context
            if session_id:
                self.db.store_context_cache(
                    session_id, context, {"sources": len(context_parts), "tokens": total_tokens}
                )
                logger.info(f"Cached context for session {session_id}")

            return {"success": True, "context": context}

        except Exception as e:
            return {"success": False, "error": str(e)}
