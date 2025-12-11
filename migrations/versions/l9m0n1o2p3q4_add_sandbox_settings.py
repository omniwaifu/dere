"""Add sandbox_settings to sessions and missions.

Revision ID: l9m0n1o2p3q4
Revises: k8l9m0n1o2p3
Create Date: 2025-12-11

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "l9m0n1o2p3q4"
down_revision: str | None = "k8l9m0n1o2p3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "sessions",
        sa.Column("sandbox_settings", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        "missions",
        sa.Column("sandbox_settings", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("missions", "sandbox_settings")
    op.drop_column("sessions", "sandbox_settings")

