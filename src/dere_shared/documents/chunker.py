"""Document chunking with sliding window and token counting."""

from __future__ import annotations

import re
from typing import Any

from loguru import logger


class DocumentChunker:
    """Chunk documents into overlapping segments for embedding."""

    def __init__(self, chunk_size: int = 1000, overlap: int = 200):
        """Initialize document chunker.

        Args:
            chunk_size: Target chunk size in tokens
            overlap: Number of overlapping tokens between chunks
        """
        if overlap >= chunk_size:
            raise ValueError(f"Overlap ({overlap}) must be less than chunk_size ({chunk_size})")

        self.chunk_size = chunk_size
        self.overlap = overlap

        # Lazy import tiktoken
        self._tiktoken_encoding = None

    def _get_encoding(self):
        """Get tiktoken encoding (lazy load)."""
        if self._tiktoken_encoding is None:
            try:
                import tiktoken

                self._tiktoken_encoding = tiktoken.get_encoding("cl100k_base")
            except ImportError:
                raise RuntimeError("tiktoken not installed (pip install tiktoken)")
        return self._tiktoken_encoding

    def count_tokens(self, text: str) -> int:
        """Count tokens in text.

        Args:
            text: Text to count

        Returns:
            Number of tokens
        """
        encoding = self._get_encoding()
        return len(encoding.encode(text))

    def chunk(self, content: str, metadata: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        """Chunk document into overlapping segments.

        Args:
            content: Document content
            metadata: Optional metadata to attach to each chunk

        Returns:
            List of chunk dicts with keys: content, tokens, chunk_index, metadata
        """
        if not content.strip():
            return []

        metadata = metadata or {}

        # Split into paragraphs first (respect natural boundaries)
        paragraphs = self._split_paragraphs(content)

        chunks = []
        current_chunk = []
        current_tokens = 0
        chunk_index = 0

        for para in paragraphs:
            para_tokens = self.count_tokens(para)

            # If single paragraph exceeds chunk_size, split it
            if para_tokens > self.chunk_size:
                # Flush current chunk if not empty
                if current_chunk:
                    chunk_content = "\n\n".join(current_chunk)
                    chunks.append(
                        {
                            "content": chunk_content,
                            "tokens": current_tokens,
                            "chunk_index": chunk_index,
                            "metadata": metadata,
                        }
                    )
                    chunk_index += 1
                    current_chunk = []
                    current_tokens = 0

                # Split large paragraph
                sub_chunks = self._split_large_paragraph(para)
                for sub_chunk in sub_chunks:
                    sub_tokens = self.count_tokens(sub_chunk)
                    chunks.append(
                        {
                            "content": sub_chunk,
                            "tokens": sub_tokens,
                            "chunk_index": chunk_index,
                            "metadata": metadata,
                        }
                    )
                    chunk_index += 1

            # If adding paragraph would exceed chunk_size, flush current chunk
            elif current_tokens + para_tokens > self.chunk_size:
                if current_chunk:
                    chunk_content = "\n\n".join(current_chunk)
                    chunks.append(
                        {
                            "content": chunk_content,
                            "tokens": current_tokens,
                            "chunk_index": chunk_index,
                            "metadata": metadata,
                        }
                    )
                    chunk_index += 1

                # Start new chunk with overlap
                overlap_paras = self._get_overlap_paragraphs(current_chunk)
                current_chunk = overlap_paras + [para]
                current_tokens = sum(self.count_tokens(p) for p in current_chunk)

            # Add paragraph to current chunk
            else:
                current_chunk.append(para)
                current_tokens += para_tokens

        # Flush remaining chunk
        if current_chunk:
            chunk_content = "\n\n".join(current_chunk)
            chunks.append(
                {
                    "content": chunk_content,
                    "tokens": current_tokens,
                    "chunk_index": chunk_index,
                    "metadata": metadata,
                }
            )

        logger.debug(f"Chunked document into {len(chunks)} chunks")
        return chunks

    def _split_paragraphs(self, content: str) -> list[str]:
        """Split content into paragraphs.

        Args:
            content: Document content

        Returns:
            List of paragraphs
        """
        # Split on double newlines or single newlines followed by list markers
        paragraphs = re.split(r"\n\n+|\n(?=[•\-\*]\s)", content)

        # Clean and filter empty paragraphs
        return [p.strip() for p in paragraphs if p.strip()]

    def _split_large_paragraph(self, paragraph: str) -> list[str]:
        """Split a large paragraph into smaller chunks.

        Args:
            paragraph: Paragraph text

        Returns:
            List of sub-chunks
        """
        # Try splitting on sentences first
        sentences = re.split(r"(?<=[.!?])\s+", paragraph)

        chunks = []
        current = []
        current_tokens = 0

        for sentence in sentences:
            sentence_tokens = self.count_tokens(sentence)

            # If single sentence exceeds chunk_size, split on words
            if sentence_tokens > self.chunk_size:
                if current:
                    chunks.append(" ".join(current))
                    current = []
                    current_tokens = 0

                # Split on words
                words = sentence.split()
                word_chunk = []
                word_tokens = 0

                for word in words:
                    word_token_count = self.count_tokens(word)
                    if word_tokens + word_token_count > self.chunk_size:
                        if word_chunk:
                            chunks.append(" ".join(word_chunk))
                        word_chunk = [word]
                        word_tokens = word_token_count
                    else:
                        word_chunk.append(word)
                        word_tokens += word_token_count

                if word_chunk:
                    chunks.append(" ".join(word_chunk))

            elif current_tokens + sentence_tokens > self.chunk_size:
                chunks.append(" ".join(current))
                current = [sentence]
                current_tokens = sentence_tokens

            else:
                current.append(sentence)
                current_tokens += sentence_tokens

        if current:
            chunks.append(" ".join(current))

        return chunks

    def _get_overlap_paragraphs(self, paragraphs: list[str]) -> list[str]:
        """Get last few paragraphs for overlap.

        Args:
            paragraphs: List of paragraphs

        Returns:
            Paragraphs to use for overlap
        """
        if not paragraphs:
            return []

        # Start from the end and collect paragraphs until we reach overlap token count
        overlap_paras = []
        overlap_tokens = 0

        for para in reversed(paragraphs):
            para_tokens = self.count_tokens(para)
            if overlap_tokens + para_tokens > self.overlap:
                break
            overlap_paras.insert(0, para)
            overlap_tokens += para_tokens

        return overlap_paras
