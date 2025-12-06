"""Make session_id nullable in emotion_states and stimulus_history for global state.

Revision ID: h5i6j7k8l9m0
Revises: g4h5i6j7k8l9
Create Date: 2025-12-06

"""

from collections.abc import Sequence

from alembic import op

revision: str = "h5i6j7k8l9m0"
down_revision: str | Sequence[str] | None = "g4h5i6j7k8l9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Drop foreign key constraints first
    op.drop_constraint(
        "emotion_states_session_id_fkey", "emotion_states", type_="foreignkey"
    )
    op.drop_constraint(
        "stimulus_history_session_id_fkey", "stimulus_history", type_="foreignkey"
    )

    # Make columns nullable
    op.alter_column("emotion_states", "session_id", nullable=True)
    op.alter_column("stimulus_history", "session_id", nullable=True)

    # Re-add foreign key constraints (now allowing NULL)
    op.create_foreign_key(
        "emotion_states_session_id_fkey",
        "emotion_states",
        "sessions",
        ["session_id"],
        ["id"],
    )
    op.create_foreign_key(
        "stimulus_history_session_id_fkey",
        "stimulus_history",
        "sessions",
        ["session_id"],
        ["id"],
    )


def downgrade() -> None:
    # Delete any rows with NULL session_id before making non-nullable
    op.execute("DELETE FROM emotion_states WHERE session_id IS NULL")
    op.execute("DELETE FROM stimulus_history WHERE session_id IS NULL")

    # Drop foreign key constraints
    op.drop_constraint(
        "emotion_states_session_id_fkey", "emotion_states", type_="foreignkey"
    )
    op.drop_constraint(
        "stimulus_history_session_id_fkey", "stimulus_history", type_="foreignkey"
    )

    # Make columns non-nullable
    op.alter_column("emotion_states", "session_id", nullable=False)
    op.alter_column("stimulus_history", "session_id", nullable=False)

    # Re-add foreign key constraints
    op.create_foreign_key(
        "emotion_states_session_id_fkey",
        "emotion_states",
        "sessions",
        ["session_id"],
        ["id"],
    )
    op.create_foreign_key(
        "stimulus_history_session_id_fkey",
        "stimulus_history",
        "sessions",
        ["session_id"],
        ["id"],
    )
