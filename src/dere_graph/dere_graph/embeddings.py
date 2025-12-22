from __future__ import annotations

import tiktoken
from openai import AsyncOpenAI

# text-embedding-3-small has 8191 token limit
MAX_TOKENS = 8000  # Leave margin for safety
CHUNK_OVERLAP_TOKENS = 200


class OpenAIEmbedder:
    def __init__(self, api_key: str | None = None, embedding_dim: int = 1536):
        self.client = AsyncOpenAI(api_key=api_key)
        self.model = "text-embedding-3-small"
        self.embedding_dim = embedding_dim
        self._encoding = tiktoken.get_encoding("cl100k_base")

    def _count_tokens(self, text: str) -> int:
        """Count tokens in text using tiktoken."""
        return len(self._encoding.encode(text))

    def _chunk_text(self, text: str) -> list[str]:
        """Split text into chunks that fit within token limit.

        Uses token-aware chunking with overlap for context continuity.
        """
        tokens = self._encoding.encode(text)
        if len(tokens) <= MAX_TOKENS:
            return [text]

        chunks = []
        start = 0
        while start < len(tokens):
            end = min(start + MAX_TOKENS, len(tokens))
            chunk_tokens = tokens[start:end]
            chunks.append(self._encoding.decode(chunk_tokens))
            if end >= len(tokens):
                break
            start = end - CHUNK_OVERLAP_TOKENS

        return chunks

    def _average_embeddings(self, embeddings: list[list[float]]) -> list[float]:
        """Average multiple embeddings into one."""
        if len(embeddings) == 1:
            return embeddings[0]

        dim = len(embeddings[0])
        averaged = [0.0] * dim
        for emb in embeddings:
            for i, val in enumerate(emb):
                averaged[i] += val
        return [v / len(embeddings) for v in averaged]

    async def create(self, input_data: str | list[str]) -> list[float]:
        """Generate embedding for a single text or list of texts.

        Long texts are chunked and embeddings are averaged.
        Returns the first embedding if input_data is a list.
        """
        text = input_data if isinstance(input_data, str) else input_data[0]
        chunks = self._chunk_text(text)

        if len(chunks) == 1:
            result = await self.client.embeddings.create(
                input=chunks[0],
                model=self.model,
            )
            return result.data[0].embedding[: self.embedding_dim]

        # Embed chunks and average
        result = await self.client.embeddings.create(
            input=chunks,
            model=self.model,
        )
        chunk_embeddings = [emb.embedding[: self.embedding_dim] for emb in result.data]
        return self._average_embeddings(chunk_embeddings)

    async def create_batch(self, input_data_list: list[str]) -> list[list[float]]:
        """Generate embeddings for multiple texts in a single batch.

        Long texts are chunked and embeddings are averaged per input.
        """
        # Build flat list of chunks with tracking
        all_chunks: list[str] = []
        chunk_ranges: list[tuple[int, int]] = []  # (start, end) indices per input

        for text in input_data_list:
            chunks = self._chunk_text(text)
            start = len(all_chunks)
            all_chunks.extend(chunks)
            chunk_ranges.append((start, len(all_chunks)))

        if not all_chunks:
            return []

        # Embed all chunks in one call
        result = await self.client.embeddings.create(
            input=all_chunks,
            model=self.model,
        )
        all_embeddings = [emb.embedding[: self.embedding_dim] for emb in result.data]

        # Reconstruct per-input embeddings by averaging chunks
        final_embeddings: list[list[float]] = []
        for start, end in chunk_ranges:
            input_chunk_embeddings = all_embeddings[start:end]
            final_embeddings.append(self._average_embeddings(input_chunk_embeddings))

        return final_embeddings
