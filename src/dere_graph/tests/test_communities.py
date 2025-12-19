from __future__ import annotations

from dere_graph.communities import _build_community_name
from dere_graph.models import EntityNode


def _member(uuid: str, name: str) -> EntityNode:
    return EntityNode(uuid=uuid, name=name, group_id="test")


def test_build_community_name_uses_sorted_unique_names() -> None:
    members = [
        _member("1", "Zed"),
        _member("2", "Alice"),
        _member("3", "Bob"),
        _member("4", "Alice"),
    ]

    name = _build_community_name(members, "Fallback")

    assert name == "Community: Alice, Bob, Zed"


def test_build_community_name_falls_back_when_empty() -> None:
    name = _build_community_name([], "Fallback")

    assert name == "Fallback"
