"""add thinking_budget to sessions

Revision ID: fb8f6ae82b83
Revises: 8c100df71c87
Create Date: 2025-12-04 06:05:34.054713

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "fb8f6ae82b83"
down_revision: str | Sequence[str] | None = "8c100df71c87"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add thinking_budget column to sessions table."""
    op.add_column("sessions", sa.Column("thinking_budget", sa.Integer(), nullable=True))


def downgrade() -> None:
    """Remove thinking_budget column from sessions table."""
    op.drop_column("sessions", "thinking_budget")
