"""add notification escalation support

Revision ID: cde1592138c8
Revises: 985ace416d98
Create Date: 2025-11-13 15:19:46.138968

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'cde1592138c8'
down_revision: str | Sequence[str] | None = '985ace416d98'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # Add escalation tracking fields to ambient_notifications
    op.add_column('ambient_notifications', sa.Column('parent_notification_id', sa.Integer(), nullable=True))
    op.add_column('ambient_notifications', sa.Column('acknowledged', sa.Boolean(), server_default='false', nullable=False))
    op.add_column('ambient_notifications', sa.Column('acknowledged_at', sa.DateTime(timezone=True), nullable=True))

    op.create_foreign_key(
        'ambient_notifications_parent_notification_id_fkey',
        'ambient_notifications',
        'ambient_notifications',
        ['parent_notification_id'],
        ['id']
    )

    # Create notification_context table
    op.create_table(
        'notification_context',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('notification_id', sa.Integer(), nullable=False),
        sa.Column('trigger_type', sa.String(), nullable=True),
        sa.Column('trigger_id', sa.String(), nullable=True),
        sa.Column('trigger_data', postgresql.JSONB(), nullable=True),
        sa.Column('context_snapshot', postgresql.JSONB(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.ForeignKeyConstraint(['notification_id'], ['ambient_notifications.id'], name='notification_context_notification_id_fkey'),
        sa.PrimaryKeyConstraint('id', name='notification_context_pkey')
    )

    op.create_index('notification_context_notification_id_idx', 'notification_context', ['notification_id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index('notification_context_notification_id_idx', table_name='notification_context')
    op.drop_table('notification_context')

    op.drop_constraint('ambient_notifications_parent_notification_id_fkey', 'ambient_notifications', type_='foreignkey')
    op.drop_column('ambient_notifications', 'acknowledged_at')
    op.drop_column('ambient_notifications', 'acknowledged')
    op.drop_column('ambient_notifications', 'parent_notification_id')
