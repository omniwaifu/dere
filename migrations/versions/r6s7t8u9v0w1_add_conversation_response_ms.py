"""Add response_ms to conversations.

Revision ID: r6s7t8u9v0w1
Revises: n2o3p4q5r6s7
Create Date: 2025-12-12

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "r6s7t8u9v0w1"
down_revision: str | None = "n2o3p4q5r6s7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("conversations", sa.Column("response_ms", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("conversations", "response_ms")

