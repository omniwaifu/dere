"""Convert swarm_agents.depends_on from ARRAY(BigInteger) to JSONB.

This enables storing dependency specs with include mode (summary/full/none)
instead of just agent IDs.

Revision ID: v0w1x2y3z4a5
Revises: u9v0w1x2y3z4
Create Date: 2025-12-16

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "v0w1x2y3z4a5"
down_revision: str | None = "u9v0w1x2y3z4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Step 1: Add new JSONB column
    op.add_column(
        "swarm_agents",
        sa.Column("depends_on_new", postgresql.JSONB(), nullable=True),
    )

    # Step 2: Migrate data - convert array of IDs to array of objects
    op.execute("""
        UPDATE swarm_agents
        SET depends_on_new = (
            SELECT jsonb_agg(jsonb_build_object('agent_id', elem::bigint, 'include', 'summary'))
            FROM unnest(depends_on) AS elem
        )
        WHERE depends_on IS NOT NULL
    """)

    # Step 3: Drop old column
    op.drop_column("swarm_agents", "depends_on")

    # Step 4: Rename new column
    op.alter_column("swarm_agents", "depends_on_new", new_column_name="depends_on")


def downgrade() -> None:
    # Step 1: Add old-style column
    op.add_column(
        "swarm_agents",
        sa.Column("depends_on_old", postgresql.ARRAY(sa.BigInteger()), nullable=True),
    )

    # Step 2: Migrate data back - extract agent_id from each object
    op.execute("""
        UPDATE swarm_agents
        SET depends_on_old = (
            SELECT array_agg((elem->>'agent_id')::bigint)
            FROM jsonb_array_elements(depends_on) AS elem
        )
        WHERE depends_on IS NOT NULL
    """)

    # Step 3: Drop JSONB column
    op.drop_column("swarm_agents", "depends_on")

    # Step 4: Rename old column back
    op.alter_column("swarm_agents", "depends_on_old", new_column_name="depends_on")
