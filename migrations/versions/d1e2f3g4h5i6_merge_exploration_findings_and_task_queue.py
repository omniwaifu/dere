"""Merge exploration findings and task queue heads.

Revision ID: d1e2f3g4h5i6
Revises: b7c8d9e0f1a2, c5a44ace8c02
Create Date: 2025-12-18

"""

from collections.abc import Sequence

revision: str = "d1e2f3g4h5i6"
down_revision: str | Sequence[str] | None = (
    "b7c8d9e0f1a2",
    "c5a44ace8c02",
)
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
