"""fix_emotion_schema_constraints

Revision ID: e9d746cbf24a
Revises: 94572cd92089
Create Date: 2025-11-11 05:36:49.697258

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'e9d746cbf24a'
down_revision: str | Sequence[str] | None = '94572cd92089'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # 1. Make emotion_states nullable columns
    op.alter_column('emotion_states', 'primary_emotion',
                    existing_type=sa.VARCHAR(),
                    nullable=True)
    op.alter_column('emotion_states', 'primary_intensity',
                    existing_type=sa.DOUBLE_PRECISION(),
                    nullable=True)
    op.alter_column('emotion_states', 'overall_intensity',
                    existing_type=sa.DOUBLE_PRECISION(),
                    nullable=True)

    # 2. Change stimulus_history.timestamp from INTEGER to BIGINT
    op.alter_column('stimulus_history', 'timestamp',
                    existing_type=sa.INTEGER(),
                    type_=sa.BIGINT(),
                    existing_nullable=False)


def downgrade() -> None:
    """Downgrade schema."""
    # Reverse: Change stimulus_history.timestamp from BIGINT to INTEGER
    op.alter_column('stimulus_history', 'timestamp',
                    existing_type=sa.BIGINT(),
                    type_=sa.INTEGER(),
                    existing_nullable=False)

    # Reverse: Make emotion_states columns NOT NULL
    op.alter_column('emotion_states', 'overall_intensity',
                    existing_type=sa.DOUBLE_PRECISION(),
                    nullable=False)
    op.alter_column('emotion_states', 'primary_intensity',
                    existing_type=sa.DOUBLE_PRECISION(),
                    nullable=False)
    op.alter_column('emotion_states', 'primary_emotion',
                    existing_type=sa.VARCHAR(),
                    nullable=False)
