"""Add summary_context table for global session summary roll-up.

Revision ID: k8l9m0n1o2p3
Revises: j7k8l9m0n1o2
Create Date: 2025-12-10

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "k8l9m0n1o2p3"
down_revision: str | None = "j7k8l9m0n1o2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "summary_context",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("session_ids", sa.ARRAY(sa.BigInteger()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("summary_context")
