"""Add core memory block tables.

Revision ID: d2e3f4g5h6i7
Revises: mrg1a2b3c4d5e
Create Date: 2026-01-05

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "d2e3f4g5h6i7"
down_revision: str | None = "mrg1a2b3c4d5e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "core_memory_blocks",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("user_id", sa.String(), nullable=True),
        sa.Column("session_id", sa.Integer(), nullable=True),
        sa.Column("block_type", sa.String(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("char_limit", sa.Integer(), nullable=False, server_default="8192"),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["session_id"], ["sessions.id"], ondelete="CASCADE"),
    )
    op.create_index(
        "core_memory_blocks_user_idx",
        "core_memory_blocks",
        ["user_id"],
        postgresql_where=sa.text("user_id IS NOT NULL"),
    )
    op.create_index(
        "core_memory_blocks_session_idx",
        "core_memory_blocks",
        ["session_id"],
        postgresql_where=sa.text("session_id IS NOT NULL"),
    )
    op.create_index(
        "core_memory_blocks_type_idx",
        "core_memory_blocks",
        ["block_type"],
    )
    op.create_index(
        "core_memory_blocks_user_type_unique",
        "core_memory_blocks",
        ["user_id", "block_type"],
        unique=True,
        postgresql_where=sa.text("session_id IS NULL AND user_id IS NOT NULL"),
    )
    op.create_index(
        "core_memory_blocks_session_type_unique",
        "core_memory_blocks",
        ["session_id", "block_type"],
        unique=True,
        postgresql_where=sa.text("session_id IS NOT NULL"),
    )

    op.create_table(
        "core_memory_versions",
        sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
        sa.Column("block_id", sa.Integer(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["block_id"], ["core_memory_blocks.id"], ondelete="CASCADE"),
    )
    op.create_index(
        "core_memory_versions_block_idx",
        "core_memory_versions",
        ["block_id"],
    )
    op.create_index(
        "core_memory_versions_block_version_unique",
        "core_memory_versions",
        ["block_id", "version"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(
        "core_memory_versions_block_version_unique",
        table_name="core_memory_versions",
    )
    op.drop_index(
        "core_memory_versions_block_idx",
        table_name="core_memory_versions",
    )
    op.drop_table("core_memory_versions")

    op.drop_index(
        "core_memory_blocks_session_type_unique",
        table_name="core_memory_blocks",
    )
    op.drop_index(
        "core_memory_blocks_user_type_unique",
        table_name="core_memory_blocks",
    )
    op.drop_index(
        "core_memory_blocks_type_idx",
        table_name="core_memory_blocks",
    )
    op.drop_index(
        "core_memory_blocks_session_idx",
        table_name="core_memory_blocks",
    )
    op.drop_index(
        "core_memory_blocks_user_idx",
        table_name="core_memory_blocks",
    )
    op.drop_table("core_memory_blocks")
