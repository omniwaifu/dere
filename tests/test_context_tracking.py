from __future__ import annotations

from dere_daemon.context_tracking import build_context_metadata, extract_cited_entity_uuids
from dere_graph.models import EntityEdge, EntityNode


def _node(uuid: str, name: str) -> EntityNode:
    return EntityNode(uuid=uuid, name=name, group_id="test")


def _edge(uuid: str, source: str, target: str, fact: str) -> EntityEdge:
    return EntityEdge(
        uuid=uuid,
        name="RELATED",
        fact=fact,
        group_id="test",
        source_node_uuid=source,
        target_node_uuid=target,
    )


def test_extract_cited_entity_uuids_matches_names() -> None:
    nodes = [_node("1", "Alice"), _node("2", "Bob")]
    edges = [_edge("e1", "1", "2", "Alice knows Bob")]
    metadata = build_context_metadata(nodes, edges)

    cited = extract_cited_entity_uuids("Alice handled the follow-up.", metadata)

    assert set(cited) == {"1"}


def test_extract_cited_entity_uuids_uses_word_boundaries() -> None:
    nodes = [_node("1", "Ann")]
    metadata = build_context_metadata(nodes, [])

    cited = extract_cited_entity_uuids("Annie helped out.", metadata)

    assert cited == []
