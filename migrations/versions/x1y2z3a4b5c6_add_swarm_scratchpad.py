"""Add swarm_scratchpad table for inter-agent coordination.

Revision ID: x1y2z3a4b5c6
Revises: w1x2y3z4a5b6
Create Date: 2025-12-16

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "x1y2z3a4b5c6"
down_revision: str | None = "w1x2y3z4a5b6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "swarm_scratchpad",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("swarm_id", sa.Integer(), nullable=False),
        sa.Column("key", sa.String(), nullable=False),
        sa.Column("value", postgresql.JSONB(), nullable=True),
        # Provenance
        sa.Column("set_by_agent_id", sa.Integer(), nullable=True),
        sa.Column("set_by_agent_name", sa.String(), nullable=True),
        # Timestamps
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        # Foreign keys with CASCADE delete
        sa.ForeignKeyConstraint(
            ["swarm_id"], ["swarms.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["set_by_agent_id"], ["swarm_agents.id"], ondelete="SET NULL"
        ),
        # Unique constraint on (swarm_id, key)
        sa.UniqueConstraint("swarm_id", "key", name="uq_swarm_scratchpad_key"),
    )
    # Index for fast swarm-scoped lookups
    op.create_index("swarm_scratchpad_swarm_idx", "swarm_scratchpad", ["swarm_id"])


def downgrade() -> None:
    op.drop_index("swarm_scratchpad_swarm_idx", table_name="swarm_scratchpad")
    op.drop_table("swarm_scratchpad")
