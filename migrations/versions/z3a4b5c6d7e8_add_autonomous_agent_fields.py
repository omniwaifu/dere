"""Add autonomous agent fields to swarm_agents.

Revision ID: z3a4b5c6d7e8
Revises: y2z3a4b5c6d7
Create Date: 2025-12-16
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ARRAY

revision = "z3a4b5c6d7e8"
down_revision = "y2z3a4b5c6d7"
branch_labels = None
depends_on = None


def upgrade():
    # Mode field (assigned vs autonomous)
    op.add_column(
        "swarm_agents",
        sa.Column("mode", sa.String(), nullable=False, server_default="assigned"),
    )

    # Autonomous agent configuration
    op.add_column(
        "swarm_agents",
        sa.Column("goal", sa.Text(), nullable=True),
    )
    op.add_column(
        "swarm_agents",
        sa.Column("capabilities", ARRAY(sa.String()), nullable=True),
    )
    op.add_column(
        "swarm_agents",
        sa.Column("task_types", ARRAY(sa.String()), nullable=True),
    )
    op.add_column(
        "swarm_agents",
        sa.Column("max_tasks", sa.Integer(), nullable=True),
    )
    op.add_column(
        "swarm_agents",
        sa.Column("max_duration_seconds", sa.Integer(), nullable=True),
    )
    op.add_column(
        "swarm_agents",
        sa.Column("idle_timeout_seconds", sa.Integer(), nullable=False, server_default="60"),
    )

    # Autonomous agent tracking
    op.add_column(
        "swarm_agents",
        sa.Column("tasks_completed", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "swarm_agents",
        sa.Column("tasks_failed", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "swarm_agents",
        sa.Column("current_task_id", sa.BigInteger(), nullable=True),
    )

    # Foreign key for current_task_id
    op.create_foreign_key(
        "fk_swarm_agents_current_task",
        "swarm_agents",
        "project_tasks",
        ["current_task_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade():
    op.drop_constraint("fk_swarm_agents_current_task", "swarm_agents", type_="foreignkey")
    op.drop_column("swarm_agents", "current_task_id")
    op.drop_column("swarm_agents", "tasks_failed")
    op.drop_column("swarm_agents", "tasks_completed")
    op.drop_column("swarm_agents", "idle_timeout_seconds")
    op.drop_column("swarm_agents", "max_duration_seconds")
    op.drop_column("swarm_agents", "max_tasks")
    op.drop_column("swarm_agents", "task_types")
    op.drop_column("swarm_agents", "capabilities")
    op.drop_column("swarm_agents", "goal")
    op.drop_column("swarm_agents", "mode")
