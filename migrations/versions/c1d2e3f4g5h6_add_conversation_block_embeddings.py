"""Add embeddings for conversation blocks.

Revision ID: c1d2e3f4g5h6
Revises: s7t8u9v0w1x2
Create Date: 2026-01-05

"""

from collections.abc import Sequence

import pgvector.sqlalchemy
import sqlalchemy as sa
from alembic import op

revision: str = "c1d2e3f4g5h6"
down_revision: str | None = "s7t8u9v0w1x2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "conversation_blocks",
        sa.Column(
            "content_embedding",
            pgvector.sqlalchemy.Vector(1536),
            nullable=True,
        ),
    )
    op.create_index(
        "idx_conversation_blocks_text",
        "conversation_blocks",
        [sa.literal_column("to_tsvector('english'::regconfig, text)")],
        unique=False,
        postgresql_using="gin",
    )
    op.create_index(
        "idx_conversation_blocks_embedding",
        "conversation_blocks",
        ["content_embedding"],
        unique=False,
        postgresql_ops={"content_embedding": "vector_cosine_ops"},
        postgresql_with={"lists": "100"},
        postgresql_using="ivfflat",
    )


def downgrade() -> None:
    op.drop_index("idx_conversation_blocks_embedding", table_name="conversation_blocks")
    op.drop_index("idx_conversation_blocks_text", table_name="conversation_blocks")
    op.drop_column("conversation_blocks", "content_embedding")
