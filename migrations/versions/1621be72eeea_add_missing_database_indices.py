"""add_missing_database_indices

Revision ID: 1621be72eeea
Revises: e9d746cbf24a
Create Date: 2025-11-11 18:02:19.086444

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '1621be72eeea'
down_revision: str | Sequence[str] | None = 'e9d746cbf24a'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # Add composite index for cross-medium conversation queries
    op.create_index(
        'conversations_user_medium_ts_idx',
        'conversations',
        ['user_id', 'medium', sa.text('timestamp DESC')],
        postgresql_where=sa.text('user_id IS NOT NULL AND medium IS NOT NULL')
    )

    # Add index for temporal ordering of conversations
    op.create_index(
        'conversations_created_at_idx',
        'conversations',
        [sa.text('created_at DESC')]
    )

    # Add composite index for emotion state lookups
    op.create_index(
        'emotion_states_session_update_idx',
        'emotion_states',
        ['session_id', sa.text('last_update DESC')]
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('emotion_states_session_update_idx', table_name='emotion_states')
    op.drop_index('conversations_created_at_idx', table_name='conversations')
    op.drop_index('conversations_user_medium_ts_idx', table_name='conversations')
