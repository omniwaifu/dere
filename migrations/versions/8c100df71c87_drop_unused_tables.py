"""drop_unused_tables

Revision ID: 8c100df71c87
Revises: f1a2b3c4d5e6
Create Date: 2025-11-23 00:57:59.449241

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '8c100df71c87'
down_revision: str | Sequence[str] | None = 'f1a2b3c4d5e6'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Drop unused tables that were never implemented."""
    op.drop_table('session_mcps')
    op.drop_table('session_flags')
    op.drop_table('entity_relationships')
    op.drop_table('conversation_segments')
    op.drop_table('session_relationships')


def downgrade() -> None:
    """Recreate unused tables."""
    op.create_table(
        'session_mcps',
        sa.Column('session_id', sa.BigInteger(), nullable=False),
        sa.Column('mcp_name', sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(['session_id'], ['sessions.id']),
        sa.PrimaryKeyConstraint('session_id', 'mcp_name'),
    )

    op.create_table(
        'session_flags',
        sa.Column('session_id', sa.BigInteger(), nullable=False),
        sa.Column('flag_name', sa.Text(), nullable=False),
        sa.Column('flag_value', sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(['session_id'], ['sessions.id']),
        sa.PrimaryKeyConstraint('session_id', 'flag_name'),
    )

    op.create_table(
        'entity_relationships',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('entity_1_id', sa.BigInteger(), nullable=False),
        sa.Column('entity_2_id', sa.BigInteger(), nullable=False),
        sa.Column('relationship_type', sa.Text(), nullable=False),
        sa.Column('confidence', sa.Float(), nullable=False),
        sa.Column('metadata', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )

    op.create_table(
        'conversation_segments',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('session_id', sa.BigInteger(), nullable=False),
        sa.Column('segment_number', sa.Integer(), nullable=False),
        sa.Column('segment_summary', sa.Text(), nullable=False),
        sa.Column('original_length', sa.Integer(), nullable=False),
        sa.Column('summary_length', sa.Integer(), nullable=False),
        sa.Column('start_conversation_id', sa.BigInteger(), nullable=False),
        sa.Column('end_conversation_id', sa.BigInteger(), nullable=False),
        sa.Column('model_used', sa.Text(), nullable=False),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.ForeignKeyConstraint(['session_id'], ['sessions.id']),
        sa.PrimaryKeyConstraint('id'),
    )

    op.create_table(
        'session_relationships',
        sa.Column('session_id', sa.BigInteger(), nullable=False),
        sa.Column('related_session_id', sa.BigInteger(), nullable=False),
        sa.Column('relationship_type', sa.Text(), nullable=False),
        sa.Column('strength', sa.Float(), nullable=False, server_default=sa.text('1.0')),
        sa.Column('created_at', sa.TIMESTAMP(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.PrimaryKeyConstraint('session_id', 'related_session_id', 'relationship_type'),
    )
