"""Add swarm and swarm_agents tables for multi-agent coordination.

Revision ID: t8u9v0w1x2y3
Revises: s7t8u9v0w1x2
Create Date: 2025-12-15

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "t8u9v0w1x2y3"
down_revision: str | None = "s7t8u9v0w1x2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Create swarms table
    op.create_table(
        "swarms",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("parent_session_id", sa.Integer(), nullable=False),
        sa.Column("working_dir", sa.String(), nullable=False),
        sa.Column("git_branch_prefix", sa.String(), nullable=True),
        sa.Column("base_branch", sa.String(), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="pending"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["parent_session_id"],
            ["sessions.id"],
        ),
    )
    op.create_index("swarms_name_idx", "swarms", ["name"])
    op.create_index("swarms_parent_session_idx", "swarms", ["parent_session_id"])
    op.create_index("swarms_status_idx", "swarms", ["status"])
    op.create_index(
        "swarms_created_idx",
        "swarms",
        [sa.text("created_at DESC")],
    )

    # Create swarm_agents table
    op.create_table(
        "swarm_agents",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("swarm_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("role", sa.String(), nullable=False, server_default="generic"),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("personality", sa.String(), nullable=True),
        sa.Column("plugins", postgresql.ARRAY(sa.String()), nullable=True),
        sa.Column("git_branch", sa.String(), nullable=True),
        sa.Column("allowed_tools", postgresql.ARRAY(sa.String()), nullable=True),
        sa.Column("thinking_budget", sa.Integer(), nullable=True),
        sa.Column("model", sa.String(), nullable=True),
        sa.Column("sandbox_mode", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("depends_on", postgresql.ARRAY(sa.BigInteger()), nullable=True),
        sa.Column("session_id", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(), nullable=False, server_default="pending"),
        sa.Column("output_text", sa.Text(), nullable=True),
        sa.Column("output_summary", sa.Text(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("tool_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["swarm_id"],
            ["swarms.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["sessions.id"],
        ),
    )
    op.create_index("swarm_agents_swarm_idx", "swarm_agents", ["swarm_id"])
    op.create_index("swarm_agents_status_idx", "swarm_agents", ["status"])


def downgrade() -> None:
    op.drop_index("swarm_agents_status_idx", table_name="swarm_agents")
    op.drop_index("swarm_agents_swarm_idx", table_name="swarm_agents")
    op.drop_table("swarm_agents")
    op.drop_index("swarms_created_idx", table_name="swarms")
    op.drop_index("swarms_status_idx", table_name="swarms")
    op.drop_index("swarms_parent_session_idx", table_name="swarms")
    op.drop_index("swarms_name_idx", table_name="swarms")
    op.drop_table("swarms")
