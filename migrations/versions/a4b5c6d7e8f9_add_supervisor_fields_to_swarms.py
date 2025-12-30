"""Add supervisor fields to swarms table.

Revision ID: a4b5c6d7e8f9
Revises: z3a4b5c6d7e8
Create Date: 2025-12-16
"""

import sqlalchemy as sa
from alembic import op

revision = "a4b5c6d7e8f9"
down_revision = "z3a4b5c6d7e8"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "swarms",
        sa.Column("auto_supervise", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "swarms",
        sa.Column("supervisor_warn_seconds", sa.Integer(), nullable=False, server_default="600"),
    )
    op.add_column(
        "swarms",
        sa.Column("supervisor_cancel_seconds", sa.Integer(), nullable=False, server_default="1800"),
    )


def downgrade():
    op.drop_column("swarms", "supervisor_cancel_seconds")
    op.drop_column("swarms", "supervisor_warn_seconds")
    op.drop_column("swarms", "auto_supervise")
