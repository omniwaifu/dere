"""add response_time field to notifications

Revision ID: f1a2b3c4d5e6
Revises: cde1592138c8
Create Date: 2025-11-14 00:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'f1a2b3c4d5e6'
down_revision: str | Sequence[str] | None = 'cde1592138c8'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # Add response_time field to ambient_notifications for FSM responsiveness tracking
    op.add_column(
        'ambient_notifications',
        sa.Column('response_time', sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('ambient_notifications', 'response_time')
