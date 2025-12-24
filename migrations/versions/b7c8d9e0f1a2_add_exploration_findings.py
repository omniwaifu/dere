"""Add exploration findings tables.

Revision ID: b7c8d9e0f1a2
Revises: mrg1a2b3c4d5e
Create Date: 2025-12-18

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "b7c8d9e0f1a2"
down_revision: str | None = "mrg1a2b3c4d5e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "exploration_findings",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("task_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=True),
        sa.Column("finding", sa.String(), nullable=False),
        sa.Column("source_context", sa.String(), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=False, server_default="0"),
        sa.Column("worth_sharing", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("share_message", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["task_id"], ["project_tasks.id"]),
    )

    op.create_table(
        "surfaced_findings",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("finding_id", sa.Integer(), nullable=False),
        sa.Column("session_id", sa.Integer(), nullable=True),
        sa.Column("surfaced_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["finding_id"], ["exploration_findings.id"]),
        sa.ForeignKeyConstraint(["session_id"], ["sessions.id"]),
        sa.UniqueConstraint(
            "finding_id",
            "session_id",
            name="uq_surfaced_findings_finding_session",
        ),
    )

    op.create_index("exploration_findings_task_idx", "exploration_findings", ["task_id"])
    op.create_index(
        "exploration_findings_user_idx",
        "exploration_findings",
        ["user_id"],
        postgresql_where=sa.text("user_id IS NOT NULL"),
    )
    op.create_index(
        "exploration_findings_created_idx",
        "exploration_findings",
        [sa.text("created_at DESC")],
    )
    op.create_index(
        "exploration_findings_text_idx",
        "exploration_findings",
        [sa.text("to_tsvector('english', finding)")],
        postgresql_using="gin",
    )

    op.create_index("surfaced_findings_finding_idx", "surfaced_findings", ["finding_id"])
    op.create_index("surfaced_findings_session_idx", "surfaced_findings", ["session_id"])
    op.create_index(
        "surfaced_findings_surfaced_idx",
        "surfaced_findings",
        [sa.text("surfaced_at DESC")],
    )


def downgrade() -> None:
    op.drop_index("surfaced_findings_surfaced_idx", table_name="surfaced_findings")
    op.drop_index("surfaced_findings_session_idx", table_name="surfaced_findings")
    op.drop_index("surfaced_findings_finding_idx", table_name="surfaced_findings")
    op.drop_index("exploration_findings_text_idx", table_name="exploration_findings")
    op.drop_index("exploration_findings_created_idx", table_name="exploration_findings")
    op.drop_index("exploration_findings_user_idx", table_name="exploration_findings")
    op.drop_index("exploration_findings_task_idx", table_name="exploration_findings")
    op.drop_table("surfaced_findings")
    op.drop_table("exploration_findings")
