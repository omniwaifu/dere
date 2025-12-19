from __future__ import annotations

from dere_graph.graph import _collect_bfs_seed_uuids, _select_with_bfs
from dere_graph.models import EntityEdge, EntityNode


def _node(uuid: str) -> EntityNode:
    return EntityNode(uuid=uuid, name=uuid, group_id="test")


def _edge(uuid: str, source: str, target: str) -> EntityEdge:
    return EntityEdge(
        uuid=uuid,
        name="RELATED",
        fact=f"{source} related to {target}",
        group_id="test",
        source_node_uuid=source,
        target_node_uuid=target,
    )


def test_collect_bfs_seed_uuids_prefers_nodes_then_edges() -> None:
    nodes = [_node("n1"), _node("n2")]
    edges = [_edge("e1", "n3", "n4"), _edge("e2", "n2", "n5")]

    seeds = _collect_bfs_seed_uuids(nodes, edges, seed_limit=3)

    assert seeds == ["n1", "n2", "n3"]


def test_select_with_bfs_reserves_slots_for_bfs() -> None:
    ranked = [_node("n1"), _node("n2"), _node("n3"), _node("n4")]
    bfs = [_node("n3"), _node("n5"), _node("n6")]

    selected = _select_with_bfs(ranked, bfs, limit=4, bfs_slots=2)

    assert [node.uuid for node in selected] == ["n1", "n2", "n5", "n6"]


def test_select_with_bfs_backfills_when_bfs_is_sparse() -> None:
    ranked = [_node("n1"), _node("n2"), _node("n3"), _node("n4")]
    bfs = [_node("n2")]

    selected = _select_with_bfs(ranked, bfs, limit=4, bfs_slots=2)

    assert [node.uuid for node in selected] == ["n1", "n2", "n3", "n4"]
