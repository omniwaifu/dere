"""add bond_state table

Revision ID: e2f3a4b5c6d7
Revises: d81ebb0487af
Create Date: 2025-12-06 07:50:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision: str = "e2f3a4b5c6d7"
down_revision: str | Sequence[str] | None = "d81ebb0487af"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "bond_state",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("affection_level", sa.Float(), nullable=False, server_default="50.0"),
        sa.Column("trend", sa.String(), nullable=False, server_default="stable"),
        sa.Column(
            "last_interaction_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("last_meaningful_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("streak_days", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("streak_last_date", sa.String(), nullable=True),
        sa.Column("affection_history", JSONB(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("bond_state_user_idx", "bond_state", ["user_id"])
    op.create_index(
        "bond_state_updated_idx",
        "bond_state",
        [sa.text("updated_at DESC")],
    )


def downgrade() -> None:
    op.drop_index("bond_state_updated_idx", table_name="bond_state")
    op.drop_index("bond_state_user_idx", table_name="bond_state")
    op.drop_table("bond_state")
