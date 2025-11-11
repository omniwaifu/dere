"""drop wellness_sessions table

Revision ID: 94572cd92089
Revises: 3782111053b0
Create Date: 2025-11-11 02:41:57.871467

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "94572cd92089"
down_revision: str | Sequence[str] | None = "3782111053b0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # Drop wellness_sessions table
    op.drop_table("wellness_sessions")


def downgrade() -> None:
    """Downgrade schema."""
    # Recreate wellness_sessions table
    op.create_table(
        "wellness_sessions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("session_id", sa.Integer(), nullable=False),
        sa.Column("mood", sa.Integer(), nullable=True),
        sa.Column("energy", sa.Integer(), nullable=True),
        sa.Column("stress", sa.Integer(), nullable=True),
        sa.Column("key_themes", sa.String(), nullable=True),
        sa.Column("notes", sa.String(), nullable=True),
        sa.Column("homework", sa.String(), nullable=True),
        sa.Column("next_step_notes", sa.String(), nullable=True),
        sa.Column("created_at", sa.Integer(), nullable=True),
        sa.Column("updated_at", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["session_id"], ["sessions.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
