"""simplify_single_personality_architecture

Revision ID: f9cb2d4c9cfe
Revises: e8978ca16a07
Create Date: 2025-11-10 16:29:00.473357

"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'f9cb2d4c9cfe'
down_revision: str | Sequence[str] | None = 'e8978ca16a07'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Simplify to single-personality architecture.

    Removes:
    - session_personalities junction table
    - user_sessions abstraction
    - conversation_insights, conversation_patterns, pattern_evolution tables

    Adds:
    - personality column to sessions table
    """
    # Add personality column to sessions
    op.add_column('sessions', sa.Column('personality', sa.Text(), nullable=True))

    # Migrate existing session_personalities data (take first personality per session)
    op.execute("""
        UPDATE sessions s
        SET personality = (
            SELECT personality_name
            FROM session_personalities sp
            WHERE sp.session_id = s.id
            LIMIT 1
        )
        WHERE EXISTS (SELECT 1 FROM session_personalities WHERE session_id = s.id)
    """)

    # Drop multi-personality tables (order matters due to FK constraints)
    op.drop_table('session_personalities')
    op.drop_table('pattern_evolution')  # Drop first due to FK to conversation_patterns
    op.drop_table('conversation_patterns')
    op.drop_table('conversation_insights')

    # Drop user_sessions FK and table
    op.drop_column('sessions', 'user_session_id')
    op.drop_table('user_sessions')


def downgrade() -> None:
    """Downgrade schema - recreate multi-personality structure."""
    # Recreate user_sessions table
    op.create_table(
        'user_sessions',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('user_id', sa.Text(), nullable=False),
        sa.Column('medium', sa.Text(), nullable=False),
        sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.text('now()'), nullable=False),
        sa.Column('last_active', sa.TIMESTAMP(), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'medium')
    )

    # Add user_session_id back to sessions
    op.add_column('sessions', sa.Column('user_session_id', sa.BigInteger(), nullable=True))

    # Recreate session_personalities junction table
    op.create_table(
        'session_personalities',
        sa.Column('session_id', sa.BigInteger(), nullable=False),
        sa.Column('personality_name', sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(['session_id'], ['sessions.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('session_id', 'personality_name')
    )

    # Migrate personality back to junction table
    op.execute("""
        INSERT INTO session_personalities (session_id, personality_name)
        SELECT id, personality FROM sessions WHERE personality IS NOT NULL
    """)

    # Drop personality column from sessions
    op.drop_column('sessions', 'personality')

    # Recreate synthesis tables
    op.create_table(
        'conversation_insights',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('personality_combo', sa.ARRAY(sa.Text()), nullable=False),
        sa.Column('user_session_id', sa.BigInteger(), nullable=False),
        sa.Column('insight_type', sa.Text(), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('confidence', sa.Float(), nullable=False),
        sa.Column('evidence', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )

    op.create_table(
        'conversation_patterns',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('personality_combo', sa.ARRAY(sa.Text()), nullable=False),
        sa.Column('pattern_type', sa.Text(), nullable=False),
        sa.Column('description', sa.Text(), nullable=False),
        sa.Column('frequency', sa.Integer(), nullable=False),
        sa.Column('session_ids', sa.ARRAY(sa.BigInteger()), nullable=False),
        sa.Column('created_at', sa.TIMESTAMP(), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )

    op.create_table(
        'pattern_evolution',
        sa.Column('id', sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column('pattern_id', sa.BigInteger(), nullable=False),
        sa.Column('snapshot_date', sa.TIMESTAMP(), nullable=False),
        sa.Column('frequency', sa.Integer(), nullable=False),
        sa.Column('metadata', sa.JSON(), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
