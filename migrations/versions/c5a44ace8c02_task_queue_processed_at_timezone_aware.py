"""task_queue processed_at timezone aware

Revision ID: c5a44ace8c02
Revises: o1p2q3r4s5t6
Create Date: 2025-12-22 12:54:13.767650

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c5a44ace8c02"
down_revision: str | Sequence[str] | None = "o1p2q3r4s5t6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        "task_queue",
        "processed_at",
        type_=sa.DateTime(timezone=True),
        existing_type=sa.DateTime(timezone=False),
    )


def downgrade() -> None:
    op.alter_column(
        "task_queue",
        "processed_at",
        type_=sa.DateTime(timezone=False),
        existing_type=sa.DateTime(timezone=True),
    )
