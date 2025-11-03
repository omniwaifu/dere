"""baseline - tables created directly

Revision ID: 181a0e67244b
Revises: 47d8676ce794
Create Date: 2025-10-28 11:00:53.474885

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "181a0e67244b"
down_revision: Union[str, Sequence[str], None] = "47d8676ce794"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
