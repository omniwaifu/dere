"""simplify_single_personality_architecture

Revision ID: e8978ca16a07
Revises: 181a0e67244b
Create Date: 2025-11-10 16:28:42.309257

"""

from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "e8978ca16a07"
down_revision: str | Sequence[str] | None = "181a0e67244b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
