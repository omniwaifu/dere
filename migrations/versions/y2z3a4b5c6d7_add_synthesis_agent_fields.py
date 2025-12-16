"""Add synthesis agent fields to swarms and swarm_agents.

Revision ID: y2z3a4b5c6d7
Revises: x1y2z3a4b5c6
Create Date: 2025-12-16
"""

from alembic import op
import sqlalchemy as sa

revision = "y2z3a4b5c6d7"
down_revision = "x1y2z3a4b5c6"
branch_labels = None
depends_on = None


def upgrade():
    # Add synthesis config to swarms table
    op.add_column(
        "swarms",
        sa.Column("auto_synthesize", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "swarms",
        sa.Column("synthesis_prompt", sa.Text(), nullable=True),
    )
    op.add_column(
        "swarms",
        sa.Column("skip_synthesis_on_failure", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "swarms",
        sa.Column("synthesis_output", sa.Text(), nullable=True),
    )
    op.add_column(
        "swarms",
        sa.Column("synthesis_summary", sa.Text(), nullable=True),
    )

    # Add synthesis marker to swarm_agents table
    op.add_column(
        "swarm_agents",
        sa.Column("is_synthesis_agent", sa.Boolean(), nullable=False, server_default="false"),
    )


def downgrade():
    op.drop_column("swarm_agents", "is_synthesis_agent")
    op.drop_column("swarms", "synthesis_summary")
    op.drop_column("swarms", "synthesis_output")
    op.drop_column("swarms", "skip_synthesis_on_failure")
    op.drop_column("swarms", "synthesis_prompt")
    op.drop_column("swarms", "auto_synthesize")
