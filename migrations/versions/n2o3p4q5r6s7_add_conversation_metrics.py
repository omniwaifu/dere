"""Add conversation personality snapshot and assistant metrics.

Revision ID: n2o3p4q5r6s7
Revises: m1n2o3p4q5r6
Create Date: 2025-12-12

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "n2o3p4q5r6s7"
down_revision: str | None = "m1n2o3p4q5r6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("conversations", sa.Column("personality", sa.String(), nullable=True))
    op.add_column("conversations", sa.Column("ttft_ms", sa.Integer(), nullable=True))
    op.add_column("conversations", sa.Column("thinking_ms", sa.Integer(), nullable=True))
    op.add_column("conversations", sa.Column("tool_uses", sa.Integer(), nullable=True))
    op.add_column(
        "conversations",
        sa.Column("tool_names", postgresql.ARRAY(sa.String()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("conversations", "tool_names")
    op.drop_column("conversations", "tool_uses")
    op.drop_column("conversations", "thinking_ms")
    op.drop_column("conversations", "ttft_ms")
    op.drop_column("conversations", "personality")

