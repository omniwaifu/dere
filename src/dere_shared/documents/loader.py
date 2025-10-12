"""Document loader for PDF, text, and markdown files."""

from __future__ import annotations

import mimetypes
from pathlib import Path
from typing import Any

from loguru import logger


class DocumentLoader:
    """Load and extract text from various document formats."""

    SUPPORTED_TYPES = {
        "application/pdf": "pdf",
        "text/plain": "text",
        "text/markdown": "markdown",
        "text/x-markdown": "markdown",
    }

    def __init__(self, max_file_size_mb: int = 50):
        """Initialize document loader.

        Args:
            max_file_size_mb: Maximum file size in megabytes
        """
        self.max_file_size_bytes = max_file_size_mb * 1024 * 1024

    def load(self, file_path: str | Path) -> dict[str, Any]:
        """Load document and extract text.

        Args:
            file_path: Path to document file

        Returns:
            Dict with keys: content (str), mime_type (str), file_size (int), metadata (dict)

        Raises:
            ValueError: If file type not supported or file too large
            RuntimeError: If loading fails
        """
        path = Path(file_path)

        if not path.exists():
            raise ValueError(f"File not found: {path}")

        # Check file size
        file_size = path.stat().st_size
        if file_size > self.max_file_size_bytes:
            max_mb = self.max_file_size_bytes / (1024 * 1024)
            raise ValueError(f"File too large: {file_size} bytes (max {max_mb}MB)")

        # Detect MIME type
        mime_type, _ = mimetypes.guess_type(str(path))
        if not mime_type or mime_type not in self.SUPPORTED_TYPES:
            raise ValueError(f"Unsupported file type: {mime_type}")

        doc_type = self.SUPPORTED_TYPES[mime_type]

        try:
            if doc_type == "pdf":
                content = self._load_pdf(path)
            elif doc_type in ("text", "markdown"):
                content = self._load_text(path)
            else:
                raise ValueError(f"Unknown document type: {doc_type}")

            return {
                "content": content,
                "mime_type": mime_type,
                "file_size": file_size,
                "metadata": {
                    "filename": path.name,
                    "extension": path.suffix,
                    "doc_type": doc_type,
                },
            }

        except Exception as e:
            logger.error(f"Failed to load document {path}: {e}")
            raise RuntimeError(f"Document loading failed: {e}")

    def _load_pdf(self, path: Path) -> str:
        """Extract text from PDF file.

        Args:
            path: Path to PDF file

        Returns:
            Extracted text content

        Raises:
            RuntimeError: If PDF extraction fails
        """
        try:
            import pymupdf  # PyMuPDF
        except ImportError:
            raise RuntimeError("pymupdf not installed (pip install pymupdf)")

        try:
            doc = pymupdf.open(path)
            text_parts = []

            for page_num in range(len(doc)):
                page = doc[page_num]
                text = page.get_text()
                if text.strip():
                    text_parts.append(text)

            doc.close()

            if not text_parts:
                raise RuntimeError("No text extracted from PDF")

            return "\n\n".join(text_parts)

        except Exception as e:
            raise RuntimeError(f"PDF extraction failed: {e}")

    def _load_text(self, path: Path) -> str:
        """Load text or markdown file.

        Args:
            path: Path to text file

        Returns:
            File content

        Raises:
            RuntimeError: If text loading fails
        """
        try:
            # Try UTF-8 first
            try:
                content = path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                # Fallback to latin-1 which accepts all byte values
                logger.warning(f"UTF-8 decode failed for {path}, using latin-1")
                content = path.read_text(encoding="latin-1")

            if not content.strip():
                raise RuntimeError("File is empty")

            return content

        except Exception as e:
            raise RuntimeError(f"Text loading failed: {e}")

    def load_from_bytes(self, file_bytes: bytes, filename: str) -> dict[str, Any]:
        """Load document from bytes (for Discord attachments, etc.).

        Args:
            file_bytes: Document bytes
            filename: Original filename

        Returns:
            Dict with keys: content, mime_type, file_size, metadata

        Raises:
            ValueError: If file type not supported or file too large
            RuntimeError: If loading fails
        """
        # Check file size
        file_size = len(file_bytes)
        if file_size > self.max_file_size_bytes:
            max_mb = self.max_file_size_bytes / (1024 * 1024)
            raise ValueError(f"File too large: {file_size} bytes (max {max_mb}MB)")

        # Detect MIME type
        mime_type, _ = mimetypes.guess_type(filename)
        if not mime_type or mime_type not in self.SUPPORTED_TYPES:
            raise ValueError(f"Unsupported file type: {mime_type}")

        doc_type = self.SUPPORTED_TYPES[mime_type]

        try:
            if doc_type == "pdf":
                content = self._load_pdf_from_bytes(file_bytes)
            elif doc_type in ("text", "markdown"):
                content = self._load_text_from_bytes(file_bytes)
            else:
                raise ValueError(f"Unknown document type: {doc_type}")

            return {
                "content": content,
                "mime_type": mime_type,
                "file_size": file_size,
                "metadata": {
                    "filename": filename,
                    "extension": Path(filename).suffix,
                    "doc_type": doc_type,
                },
            }

        except Exception as e:
            logger.error(f"Failed to load document from bytes: {e}")
            raise RuntimeError(f"Document loading failed: {e}")

    def _load_pdf_from_bytes(self, file_bytes: bytes) -> str:
        """Extract text from PDF bytes."""
        try:
            import pymupdf
        except ImportError:
            raise RuntimeError("pymupdf not installed (pip install pymupdf)")

        try:
            doc = pymupdf.open(stream=file_bytes, filetype="pdf")
            text_parts = []

            for page_num in range(len(doc)):
                page = doc[page_num]
                text = page.get_text()
                if text.strip():
                    text_parts.append(text)

            doc.close()

            if not text_parts:
                raise RuntimeError("No text extracted from PDF")

            return "\n\n".join(text_parts)

        except Exception as e:
            raise RuntimeError(f"PDF extraction failed: {e}")

    def _load_text_from_bytes(self, file_bytes: bytes) -> str:
        """Load text from bytes."""
        try:
            # Try UTF-8 first
            try:
                content = file_bytes.decode("utf-8")
            except UnicodeDecodeError:
                # Fallback to latin-1
                logger.warning("UTF-8 decode failed, using latin-1")
                content = file_bytes.decode("latin-1")

            if not content.strip():
                raise RuntimeError("File is empty")

            return content

        except Exception as e:
            raise RuntimeError(f"Text loading failed: {e}")
