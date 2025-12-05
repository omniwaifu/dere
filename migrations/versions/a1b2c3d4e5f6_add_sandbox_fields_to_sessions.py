"""add sandbox_mode and is_locked to sessions

Revision ID: a1b2c3d4e5f6
Revises: fb8f6ae82b83
Create Date: 2025-12-04 09:30:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: str | Sequence[str] | None = "fb8f6ae82b83"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add sandbox_mode and is_locked columns to sessions table."""
    op.add_column("sessions", sa.Column("sandbox_mode", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("sessions", sa.Column("is_locked", sa.Boolean(), nullable=False, server_default="false"))


def downgrade() -> None:
    """Remove sandbox_mode and is_locked columns from sessions table."""
    op.drop_column("sessions", "is_locked")
    op.drop_column("sessions", "sandbox_mode")
