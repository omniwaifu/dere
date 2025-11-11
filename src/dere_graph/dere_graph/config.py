from __future__ import annotations

import tomllib
from pathlib import Path

from pydantic import BaseModel


class FalkorDBConfig(BaseModel):
    host: str = "localhost"
    port: int = 6379
    graph_name: str = "dere_graph"


class ExtractionModelConfig(BaseModel):
    model: str = "claude-haiku-4-5"


class EmbedderConfig(BaseModel):
    model: str = "text-embedding-3-small"
    dimension: int = 1536


class PostgresConfig(BaseModel):
    db_url: str | None = None


class ProcessingConfig(BaseModel):
    max_concurrent: int = 5
    deduplication_context_limit: int = 10


class DereGraphConfig(BaseModel):
    falkordb: FalkorDBConfig = FalkorDBConfig()
    extraction_model: ExtractionModelConfig = ExtractionModelConfig()
    embedder: EmbedderConfig = EmbedderConfig()
    postgres: PostgresConfig = PostgresConfig()
    processing: ProcessingConfig = ProcessingConfig()


def load_config(config_path: str | Path | None = None) -> DereGraphConfig:
    """Load dere_graph configuration from TOML file."""
    if config_path is None:
        config_path = Path(__file__).parent.parent / "config.toml"
    else:
        config_path = Path(config_path)

    if not config_path.exists():
        # Return defaults if config doesn't exist
        return DereGraphConfig()

    with open(config_path, "rb") as f:
        data = tomllib.load(f)

    # Extract dere_graph section
    dere_graph_data = data.get("dere_graph", {})
    return DereGraphConfig(**dere_graph_data)
