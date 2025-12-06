"""add missions tables

Revision ID: 2378ef323cb8
Revises: a1b2c3d4e5f6
Create Date: 2025-12-06 03:16:32.189081

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "2378ef323cb8"
down_revision: str | Sequence[str] | None = "a1b2c3d4e5f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create missions and mission_executions tables."""
    op.create_table(
        "missions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("cron_expression", sa.String(), nullable=False),
        sa.Column("natural_language_schedule", sa.String(), nullable=True),
        sa.Column("timezone", sa.String(), nullable=False, server_default="UTC"),
        sa.Column("personality", sa.String(), nullable=True),
        sa.Column("allowed_tools", postgresql.ARRAY(sa.String()), nullable=True),
        sa.Column("mcp_servers", postgresql.ARRAY(sa.String()), nullable=True),
        sa.Column("plugins", postgresql.ARRAY(sa.String()), nullable=True),
        sa.Column("thinking_budget", sa.Integer(), nullable=True),
        sa.Column(
            "model", sa.String(), nullable=False, server_default="claude-sonnet-4-20250514"
        ),
        sa.Column("working_dir", sa.String(), nullable=False, server_default="/workspace"),
        sa.Column("sandbox_mode", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("sandbox_mount_type", sa.String(), nullable=False, server_default="none"),
        sa.Column("status", sa.String(), nullable=False, server_default="active"),
        sa.Column("next_execution_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_execution_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("user_id", sa.String(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_missions_name"), "missions", ["name"], unique=False)
    op.create_index(
        "missions_created_idx",
        "missions",
        ["created_at"],
        unique=False,
        postgresql_ops={"created_at": "DESC"},
    )
    op.create_index(
        "missions_status_next_exec_idx", "missions", ["status", "next_execution_at"], unique=False
    )

    op.create_table(
        "mission_executions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("mission_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(), nullable=False, server_default="pending"),
        sa.Column("trigger_type", sa.String(), nullable=False, server_default="scheduled"),
        sa.Column("triggered_by", sa.String(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("output_text", sa.Text(), nullable=True),
        sa.Column("output_summary", sa.Text(), nullable=True),
        sa.Column("tool_count", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column(
            "execution_metadata", postgresql.JSONB(astext_type=sa.Text()), nullable=True
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
        sa.ForeignKeyConstraint(["mission_id"], ["missions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "mission_executions_mission_idx", "mission_executions", ["mission_id"], unique=False
    )
    op.create_index(
        "mission_executions_started_idx",
        "mission_executions",
        ["started_at"],
        unique=False,
        postgresql_ops={"started_at": "DESC"},
    )


def downgrade() -> None:
    """Drop missions and mission_executions tables."""
    op.drop_index(
        "mission_executions_started_idx",
        table_name="mission_executions",
        postgresql_ops={"started_at": "DESC"},
    )
    op.drop_index("mission_executions_mission_idx", table_name="mission_executions")
    op.drop_table("mission_executions")

    op.drop_index("missions_status_next_exec_idx", table_name="missions")
    op.drop_index(
        "missions_created_idx", table_name="missions", postgresql_ops={"created_at": "DESC"}
    )
    op.drop_index(op.f("ix_missions_name"), table_name="missions")
    op.drop_table("missions")
