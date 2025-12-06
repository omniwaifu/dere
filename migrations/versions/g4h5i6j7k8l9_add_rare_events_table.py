"""add rare_events table

Revision ID: g4h5i6j7k8l9
Revises: f3g4h5i6j7k8
Create Date: 2025-12-06 09:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision: str = "g4h5i6j7k8l9"
down_revision: str | Sequence[str] | None = "f3g4h5i6j7k8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "rare_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("event_type", sa.String(), nullable=False),
        sa.Column("content", JSONB(), nullable=True),
        sa.Column("trigger_reason", sa.String(), nullable=False),
        sa.Column("trigger_context", JSONB(), nullable=True),
        sa.Column("shown_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("dismissed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("rare_events_user_idx", "rare_events", ["user_id"])
    op.create_index(
        "rare_events_created_idx",
        "rare_events",
        [sa.text("created_at DESC")],
    )


def downgrade() -> None:
    op.drop_index("rare_events_created_idx", table_name="rare_events")
    op.drop_index("rare_events_user_idx", table_name="rare_events")
    op.drop_table("rare_events")
