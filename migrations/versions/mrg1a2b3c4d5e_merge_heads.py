"""Merge alembic heads.

Revision ID: mrg1a2b3c4d5e
Revises: a4b5c6d7e8f9, c1d2e3f4g5h6
Create Date: 2026-01-05

"""

from collections.abc import Sequence

revision: str = "mrg1a2b3c4d5e"
down_revision: str | None = ("a4b5c6d7e8f9", "c1d2e3f4g5h6")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
