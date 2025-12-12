"""Drop unused conversation embedding columns.

Revision ID: m1n2o3p4q5r6
Revises: l9m0n1o2p3q4
Create Date: 2025-12-12

"""

from collections.abc import Sequence

import pgvector.sqlalchemy
import sqlalchemy as sa
from alembic import op

revision: str = "m1n2o3p4q5r6"
down_revision: str | None = "l9m0n1o2p3q4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_column("conversations", "prompt_embedding")
    op.drop_column("conversations", "embedding_text")


def downgrade() -> None:
    op.add_column(
        "conversations",
        sa.Column("embedding_text", sa.Text(), nullable=True),
    )
    op.add_column(
        "conversations",
        sa.Column("prompt_embedding", pgvector.sqlalchemy.Vector(1024), nullable=True),
    )

