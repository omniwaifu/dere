"""Add project_tasks table for persistent work queue.

Revision ID: w1x2y3z4a5b6
Revises: v0w1x2y3z4a5
Create Date: 2025-12-16

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "w1x2y3z4a5b6"
down_revision: str | None = "v0w1x2y3z4a5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "project_tasks",
        # Identity
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("working_dir", sa.String(), nullable=False),
        # Task definition
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("acceptance_criteria", sa.Text(), nullable=True),
        sa.Column("context_summary", sa.Text(), nullable=True),
        # Scoping
        sa.Column("scope_paths", postgresql.ARRAY(sa.String()), nullable=True),
        sa.Column("required_tools", postgresql.ARRAY(sa.String()), nullable=True),
        # Classification
        sa.Column("task_type", sa.String(), nullable=True),
        sa.Column("tags", postgresql.ARRAY(sa.String()), nullable=True),
        sa.Column("estimated_effort", sa.String(), nullable=True),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="0"),
        # Status
        sa.Column("status", sa.String(), nullable=False, server_default="backlog"),
        # Assignment
        sa.Column("claimed_by_session_id", sa.Integer(), nullable=True),
        sa.Column("claimed_by_agent_id", sa.Integer(), nullable=True),
        sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
        # Dependencies
        sa.Column("blocked_by", postgresql.ARRAY(sa.BigInteger()), nullable=True),
        sa.Column("related_task_ids", postgresql.ARRAY(sa.BigInteger()), nullable=True),
        # Provenance
        sa.Column("created_by_session_id", sa.Integer(), nullable=True),
        sa.Column("created_by_agent_id", sa.Integer(), nullable=True),
        sa.Column("discovered_from_task_id", sa.Integer(), nullable=True),
        sa.Column("discovery_reason", sa.Text(), nullable=True),
        # Results
        sa.Column("outcome", sa.Text(), nullable=True),
        sa.Column("completion_notes", sa.Text(), nullable=True),
        sa.Column("files_changed", postgresql.ARRAY(sa.String()), nullable=True),
        sa.Column("follow_up_task_ids", postgresql.ARRAY(sa.BigInteger()), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        # Extra data
        sa.Column("extra", postgresql.JSONB(), nullable=True),
        # Timestamps
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        # Foreign keys
        sa.ForeignKeyConstraint(["claimed_by_session_id"], ["sessions.id"]),
        sa.ForeignKeyConstraint(["claimed_by_agent_id"], ["swarm_agents.id"]),
        sa.ForeignKeyConstraint(["created_by_session_id"], ["sessions.id"]),
        sa.ForeignKeyConstraint(["created_by_agent_id"], ["swarm_agents.id"]),
        sa.ForeignKeyConstraint(["discovered_from_task_id"], ["project_tasks.id"]),
    )

    # Performance indexes
    op.create_index("project_tasks_working_dir_idx", "project_tasks", ["working_dir"])
    op.create_index("project_tasks_status_idx", "project_tasks", ["status"])
    op.create_index("project_tasks_task_type_idx", "project_tasks", ["task_type"])
    op.create_index(
        "project_tasks_tags_idx",
        "project_tasks",
        ["tags"],
        postgresql_using="gin",
    )
    op.create_index(
        "project_tasks_blocked_by_idx",
        "project_tasks",
        ["blocked_by"],
        postgresql_using="gin",
    )
    # Partial index for ready tasks query optimization
    op.create_index(
        "project_tasks_ready_idx",
        "project_tasks",
        ["working_dir", "status", sa.text("priority DESC")],
        postgresql_where=sa.text(
            "status = 'ready' AND claimed_by_session_id IS NULL AND claimed_by_agent_id IS NULL"
        ),
    )
    op.create_index(
        "project_tasks_created_idx",
        "project_tasks",
        [sa.text("created_at DESC")],
    )


def downgrade() -> None:
    op.drop_index("project_tasks_created_idx", table_name="project_tasks")
    op.drop_index("project_tasks_ready_idx", table_name="project_tasks")
    op.drop_index("project_tasks_blocked_by_idx", table_name="project_tasks")
    op.drop_index("project_tasks_tags_idx", table_name="project_tasks")
    op.drop_index("project_tasks_task_type_idx", table_name="project_tasks")
    op.drop_index("project_tasks_status_idx", table_name="project_tasks")
    op.drop_index("project_tasks_working_dir_idx", table_name="project_tasks")
    op.drop_table("project_tasks")
