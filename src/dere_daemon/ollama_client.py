from __future__ import annotations

import asyncio
from datetime import datetime, timedelta
from typing import Any

import httpx
from ollama import AsyncClient


class OllamaClient:
    """Async Ollama client for embeddings and text generation with health monitoring"""

    def __init__(
        self,
        base_url: str = "http://localhost:11434",
        embedding_model: str = "mxbai-embed-large",
        summarization_model: str = "gemma3n:latest",
    ):
        self.base_url = base_url
        self.embedding_model = embedding_model
        self.summarization_model = summarization_model

        # Use ollama's async client
        self.client = AsyncClient(host=base_url)

        # Health check state
        self._is_healthy = True
        self._last_health_check = datetime.now()
        self._health_check_task: asyncio.Task | None = None

    async def start(self) -> None:
        """Start health check background task"""
        self._health_check_task = asyncio.create_task(self._run_health_check())

    async def shutdown(self) -> None:
        """Shutdown client and cancel background tasks"""
        if self._health_check_task:
            self._health_check_task.cancel()
            try:
                await self._health_check_task
            except asyncio.CancelledError:
                pass

    async def _run_health_check(self) -> None:
        """Run periodic health checks"""
        await self._check_health()

        while True:
            await asyncio.sleep(30)
            await self._check_health()

    async def _check_health(self) -> bool:
        """Check if Ollama server is healthy"""
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(f"{self.base_url}/api/tags", timeout=5.0)
                self._is_healthy = resp.status_code == 200
                self._last_health_check = datetime.now()
                return self._is_healthy
        except Exception:
            self._is_healthy = False
            self._last_health_check = datetime.now()
            return False

    async def _ensure_healthy(self) -> bool:
        """Ensure server is healthy, attempting recovery if needed"""
        # If healthy and checked recently, assume still healthy
        if self._is_healthy and datetime.now() - self._last_health_check < timedelta(seconds=30):
            return True

        # Perform health check
        if await self._check_health():
            return True

        # Try to recover
        await asyncio.sleep(2)
        return await self._check_health()

    async def get_embedding(self, text: str) -> list[float]:
        """Get embedding vector for text with retry logic"""
        if not await self._ensure_healthy():
            raise RuntimeError("Ollama server is not healthy")

        max_retries = 3
        base_delay = 1.0

        for attempt in range(max_retries):
            try:
                response = await self.client.embeddings(model=self.embedding_model, prompt=text)
                return response["embedding"]

            except Exception as e:
                if attempt < max_retries - 1:
                    delay = base_delay * (2**attempt)
                    await asyncio.sleep(delay)
                    continue
                raise RuntimeError(f"Failed to get embedding after {max_retries} retries: {e}")

        raise RuntimeError(f"Failed to get embedding after {max_retries} retries")

    async def generate(
        self, prompt: str, model: str | None = None, schema: dict[str, Any] | None = None
    ) -> str:
        """Generate text with optional JSON schema"""
        if not await self._ensure_healthy():
            raise RuntimeError("Ollama server is not healthy")

        model = model or self.summarization_model
        max_retries = 3
        base_delay = 1.0

        for attempt in range(max_retries):
            try:
                response = await self.client.generate(
                    model=model, prompt=prompt, stream=False, format=schema if schema else None
                )
                return response["response"]

            except Exception as e:
                if not await self.is_available():
                    self._is_healthy = False
                    if await self._ensure_healthy():
                        continue

                if attempt < max_retries - 1:
                    delay = base_delay * (2**attempt)
                    await asyncio.sleep(delay)
                    continue

                raise RuntimeError(f"Failed to generate after {max_retries} retries: {e}")

        raise RuntimeError(f"Failed to generate after {max_retries} retries")

    async def is_available(self) -> bool:
        """Check if Ollama server is available and has the required model"""
        try:
            response = await self.client.list()
            models = response.get("models", [])

            # Check if our model exists
            for model in models:
                model_name = model.get("name", "")
                if model_name == self.embedding_model or model_name == f"{self.embedding_model}:latest":
                    return True

            return False

        except Exception:
            return False

    async def prewarm_model(self, model_name: str) -> None:
        """Prewarm a model by loading it into memory"""
        try:
            await self.client.generate(model=model_name, prompt="test", stream=False)
        except Exception as e:
            raise RuntimeError(f"Failed to prewarm model {model_name}: {e}")

    async def get_model_context_length(self, model_name: str) -> int:
        """Get the context length for a model"""
        try:
            response = await self.client.show(model_name)
            model_info = response.get("model_info", {})

            # Look for context_length in model_info
            for key, value in model_info.items():
                if key.endswith(".context_length"):
                    return int(value)

            # Fallback to reasonable default
            return 2048

        except Exception:
            return 2048


def get_entity_extraction_schema() -> dict[str, Any]:
    """Get JSON schema for entity extraction"""
    return {
        "type": "object",
        "properties": {
            "entities": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "type": {"type": "string"},
                        "value": {"type": "string"},
                        "normalized_value": {"type": "string"},
                        "confidence": {"type": "number"},
                    },
                    "required": ["type", "value", "confidence"],
                },
            }
        },
        "required": ["entities"],
    }
