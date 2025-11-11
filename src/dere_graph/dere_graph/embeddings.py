from __future__ import annotations

from openai import AsyncOpenAI


class OpenAIEmbedder:
    def __init__(self, api_key: str | None = None, embedding_dim: int = 1536):
        self.client = AsyncOpenAI(api_key=api_key)
        self.model = "text-embedding-3-small"
        self.embedding_dim = embedding_dim

    async def create(self, input_data: str | list[str]) -> list[float]:
        """Generate embedding for a single text or list of texts.

        Returns the first embedding if input_data is a list.
        """
        result = await self.client.embeddings.create(
            input=input_data,
            model=self.model,
        )
        return result.data[0].embedding[: self.embedding_dim]

    async def create_batch(self, input_data_list: list[str]) -> list[list[float]]:
        """Generate embeddings for multiple texts in a single batch."""
        result = await self.client.embeddings.create(
            input=input_data_list,
            model=self.model,
        )
        return [embedding.embedding[: self.embedding_dim] for embedding in result.data]
