"""drop tamagotchi tables (bond_state, ui_preferences, rare_events)

Revision ID: i6j7k8l9m0n1
Revises: h5i6j7k8l9m0
Create Date: 2025-12-10

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "i6j7k8l9m0n1"
down_revision: str | Sequence[str] | None = "h5i6j7k8l9m0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Drop rare_events table and indices
    op.drop_index("rare_events_created_idx", table_name="rare_events")
    op.drop_index("rare_events_user_idx", table_name="rare_events")
    op.drop_table("rare_events")

    # Drop ui_preferences table and index
    op.drop_index("ui_preferences_user_idx", table_name="ui_preferences")
    op.drop_table("ui_preferences")

    # Drop bond_state table and indices
    op.drop_index("bond_state_updated_idx", table_name="bond_state")
    op.drop_index("bond_state_user_idx", table_name="bond_state")
    op.drop_table("bond_state")


def downgrade() -> None:
    # Recreate bond_state table
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

    # Recreate ui_preferences table
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

    # Recreate rare_events table
    op.create_table(
        "rare_events",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("event_type", sa.String(), nullable=False),
        sa.Column("content", JSONB(), nullable=True),
        sa.Column("trigger_reason", sa.String(), nullable=False),
        sa.Column("trigger_context", JSONB(), nullable=True),
        sa.Column("shown_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("dismissed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("rare_events_user_idx", "rare_events", ["user_id"])
    op.create_index(
        "rare_events_created_idx",
        "rare_events",
        [sa.text("created_at DESC")],
    )
