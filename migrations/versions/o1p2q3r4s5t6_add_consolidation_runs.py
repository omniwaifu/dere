"""Add consolidation runs table.

Revision ID: o1p2q3r4s5t6
Revises: d2e3f4g5h6i7
Create Date: 2026-01-10

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "o1p2q3r4s5t6"
down_revision: str | None = "d2e3f4g5h6i7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "consolidation_runs",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("user_id", sa.String(), nullable=True),
        sa.Column("task_id", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("recency_days", sa.Integer(), nullable=True),
        sa.Column("community_resolution", sa.Float(), nullable=True),
        sa.Column("update_core_memory", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("triggered_by", sa.String(), nullable=True),
        sa.Column("stats", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["task_id"], ["task_queue.id"], ondelete="SET NULL"),
    )

    op.create_index(
        "consolidation_runs_user_idx",
        "consolidation_runs",
        ["user_id"],
        postgresql_where=sa.text("user_id IS NOT NULL"),
    )
    op.create_index(
        "consolidation_runs_status_idx",
        "consolidation_runs",
        ["status"],
    )
    op.create_index(
        "consolidation_runs_started_idx",
        "consolidation_runs",
        ["started_at"],
        postgresql_ops={"started_at": "DESC"},
    )
    op.create_index(
        "consolidation_runs_task_idx",
        "consolidation_runs",
        ["task_id"],
        postgresql_where=sa.text("task_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index(
        "consolidation_runs_task_idx",
        table_name="consolidation_runs",
    )
    op.drop_index(
        "consolidation_runs_started_idx",
        table_name="consolidation_runs",
    )
    op.drop_index(
        "consolidation_runs_status_idx",
        table_name="consolidation_runs",
    )
    op.drop_index(
        "consolidation_runs_user_idx",
        table_name="consolidation_runs",
    )
    op.drop_table("consolidation_runs")
