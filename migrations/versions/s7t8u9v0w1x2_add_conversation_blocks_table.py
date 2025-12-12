"""Add conversation_blocks table for normalized assistant history.

Revision ID: s7t8u9v0w1x2
Revises: r6s7t8u9v0w1
Create Date: 2025-12-12

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "s7t8u9v0w1x2"
down_revision: str | None = "r6s7t8u9v0w1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "conversation_blocks",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("conversation_id", sa.Integer(), nullable=False),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("block_type", sa.String(), nullable=False),
        sa.Column("text", sa.Text(), nullable=True),
        sa.Column("tool_use_id", sa.String(), nullable=True),
        sa.Column("tool_name", sa.String(), nullable=True),
        sa.Column("tool_input", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("is_error", sa.Boolean(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["conversation_id"],
            ["conversations.id"],
            ondelete="CASCADE",
        ),
    )
    op.create_index(
        "conversation_blocks_conversation_idx",
        "conversation_blocks",
        ["conversation_id"],
    )
    op.create_index(
        "conversation_blocks_conversation_ordinal_idx",
        "conversation_blocks",
        ["conversation_id", "ordinal"],
        unique=True,
    )
    op.create_index(
        "conversation_blocks_tool_use_id_idx",
        "conversation_blocks",
        ["tool_use_id"],
    )


def downgrade() -> None:
    op.drop_index("conversation_blocks_tool_use_id_idx", table_name="conversation_blocks")
    op.drop_index("conversation_blocks_conversation_ordinal_idx", table_name="conversation_blocks")
    op.drop_index("conversation_blocks_conversation_idx", table_name="conversation_blocks")
    op.drop_table("conversation_blocks")

