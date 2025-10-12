"""Document embedding generation wrapper for OllamaClient."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from loguru import logger

if TYPE_CHECKING:
    from dere_daemon.ollama_client import OllamaClient


class DocumentEmbedder:
    """Generate embeddings for document chunks using OllamaClient."""

    def __init__(self, ollama_client: OllamaClient):
        """Initialize embedder with OllamaClient.

        Args:
            ollama_client: Configured OllamaClient instance
        """
        self.ollama = ollama_client

    async def embed_chunk(self, chunk: dict[str, Any]) -> list[float]:
        """Generate embedding for a single chunk.

        Args:
            chunk: Chunk dict with 'content' key

        Returns:
            Embedding vector

        Raises:
            RuntimeError: If embedding generation fails
        """
        content = chunk.get("content", "")
        if not content:
            raise ValueError("Chunk has no content")

        try:
            embedding = await self.ollama.get_embedding(content)
            return embedding
        except Exception as e:
            logger.error(f"Failed to generate embedding for chunk: {e}")
            raise RuntimeError(f"Embedding generation failed: {e}")

    async def embed_chunks(self, chunks: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Generate embeddings for multiple chunks.

        Args:
            chunks: List of chunk dicts

        Returns:
            Chunks with 'embedding' key added

        Raises:
            RuntimeError: If embedding generation fails
        """
        if not chunks:
            return []

        embedded_chunks = []

        for i, chunk in enumerate(chunks):
            try:
                embedding = await self.embed_chunk(chunk)
                chunk_with_embedding = chunk.copy()
                chunk_with_embedding["embedding"] = embedding
                embedded_chunks.append(chunk_with_embedding)

                if (i + 1) % 10 == 0:
                    logger.debug(f"Embedded {i + 1}/{len(chunks)} chunks")

            except Exception as e:
                logger.warning(f"Failed to embed chunk {i}: {e}")
                # Continue with other chunks even if one fails
                continue

        logger.info(f"Successfully embedded {len(embedded_chunks)}/{len(chunks)} chunks")
        return embedded_chunks

    async def embed_query(self, query: str) -> list[float]:
        """Generate embedding for a query string.

        Args:
            query: Query text

        Returns:
            Embedding vector

        Raises:
            RuntimeError: If embedding generation fails
        """
        if not query.strip():
            raise ValueError("Query is empty")

        try:
            embedding = await self.ollama.get_embedding(query)
            return embedding
        except Exception as e:
            logger.error(f"Failed to generate embedding for query: {e}")
            raise RuntimeError(f"Query embedding failed: {e}")
