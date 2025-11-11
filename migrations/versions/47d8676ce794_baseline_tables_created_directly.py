"""baseline - tables created directly

Revision ID: 47d8676ce794
Revises:
Create Date: 2025-10-28 04:20:58.033061

"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "47d8676ce794"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
