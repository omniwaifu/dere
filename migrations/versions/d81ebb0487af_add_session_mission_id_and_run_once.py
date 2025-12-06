"""add session mission_id and mission run_once

Revision ID: d81ebb0487af
Revises: 2378ef323cb8
Create Date: 2025-12-06 04:55:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d81ebb0487af"
down_revision: str | Sequence[str] | None = "2378ef323cb8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Add run_once column to missions
    op.add_column("missions", sa.Column("run_once", sa.Boolean(), nullable=False, server_default="false"))

    # Add mission_id column to sessions with foreign key
    op.add_column("sessions", sa.Column("mission_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_sessions_mission_id",
        "sessions",
        "missions",
        ["mission_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_sessions_mission_id", "sessions", type_="foreignkey")
    op.drop_column("sessions", "mission_id")
    op.drop_column("missions", "run_once")
