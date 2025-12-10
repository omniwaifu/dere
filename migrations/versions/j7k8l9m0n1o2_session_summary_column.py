"""Add summary column to sessions and drop session_summaries table.

Revision ID: j7k8l9m0n1o2
Revises: i6j7k8l9m0n1
Create Date: 2025-12-10

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "j7k8l9m0n1o2"
down_revision: str | None = "i6j7k8l9m0n1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Add summary columns to sessions table
    op.add_column("sessions", sa.Column("summary", sa.Text(), nullable=True))
    op.add_column(
        "sessions",
        sa.Column("summary_updated_at", sa.DateTime(timezone=True), nullable=True),
    )

    # Drop the session_summaries table
    op.drop_table("session_summaries")


def downgrade() -> None:
    # Recreate session_summaries table
    op.create_table(
        "session_summaries",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("session_id", sa.Integer(), sa.ForeignKey("sessions.id"), nullable=False),
        sa.Column("summary_type", sa.String(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("key_topics", sa.ARRAY(sa.String()), nullable=True),
        sa.Column("key_entities", sa.ARRAY(sa.Integer()), nullable=True),
        sa.Column("task_status", sa.JSON(), nullable=True),
        sa.Column("next_steps", sa.Text(), nullable=True),
        sa.Column("model_used", sa.String(), nullable=True),
        sa.Column("processing_time_ms", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
    )

    # Drop summary columns from sessions
    op.drop_column("sessions", "summary_updated_at")
    op.drop_column("sessions", "summary")
