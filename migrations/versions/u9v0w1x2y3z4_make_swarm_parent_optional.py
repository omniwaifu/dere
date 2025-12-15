"""Make swarm parent_session_id nullable.

Revision ID: u9v0w1x2y3z4
Revises: t8u9v0w1x2y3
Create Date: 2025-12-15

"""

from collections.abc import Sequence

from alembic import op

revision: str = "u9v0w1x2y3z4"
down_revision: str | None = "t8u9v0w1x2y3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        "swarms",
        "parent_session_id",
        nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        "swarms",
        "parent_session_id",
        nullable=False,
    )
