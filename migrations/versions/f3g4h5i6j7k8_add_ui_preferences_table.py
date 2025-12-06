"""add ui_preferences table

Revision ID: f3g4h5i6j7k8
Revises: e2f3a4b5c6d7
Create Date: 2025-12-06 08:30:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision: str = "f3g4h5i6j7k8"
down_revision: str | Sequence[str] | None = "e2f3a4b5c6d7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ui_preferences",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("theme", sa.String(), nullable=False, server_default="default"),
        sa.Column("custom_accent_hue", sa.Integer(), nullable=True),
        sa.Column("right_panel_state", sa.String(), nullable=False, server_default="expanded"),
        sa.Column("left_panel_state", sa.String(), nullable=False, server_default="expanded"),
        sa.Column("hidden_widgets", JSONB(), nullable=True),
        sa.Column("set_by", sa.String(), nullable=False, server_default="user"),
        sa.Column("last_rearranged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_change_reason", sa.String(), nullable=True),
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
    op.create_index("ui_preferences_user_idx", "ui_preferences", ["user_id"])


def downgrade() -> None:
    op.drop_index("ui_preferences_user_idx", table_name="ui_preferences")
    op.drop_table("ui_preferences")
