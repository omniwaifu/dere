"""remove unused mode fields

Revision ID: 3782111053b0
Revises: f9cb2d4c9cfe
Create Date: 2025-11-11 02:03:45.659030

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "3782111053b0"
down_revision: str | Sequence[str] | None = "f9cb2d4c9cfe"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    # Remove unused mode-related columns
    op.drop_column("conversations", "processing_mode")
    op.drop_column("wellness_sessions", "mode")


def downgrade() -> None:
    """Downgrade schema."""
    # Restore mode-related columns
    op.add_column("conversations", sa.Column("processing_mode", sa.String(), nullable=True))
    op.add_column("wellness_sessions", sa.Column("mode", sa.String(), nullable=False))
